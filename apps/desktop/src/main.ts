// Electron main process for FZA Retail-POS (client only: the API and PostgreSQL run on the server PC).
//
// Security model (see docs/DESKTOP.md):
//  - The UI is served from a private scheme, mafk-app://local, from the built web app. No remote code is loaded.
//  - Requests to mafk-app://local/api/* are forwarded by THIS process to the configured server, so the page never talks to
//    another origin (no CORS, and the server's SameSite refresh cookie stays first-party inside the shell).
//  - contextIsolation + sandbox on, nodeIntegration off, all permission prompts denied, navigation and new windows blocked.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig, saveConfig } from './config-store';
import { getMachineSerial } from './machine-serial';
import type { DesktopConfig } from './config-store';
import {
  APP_ORIGIN,
  APP_SCHEME,
  buildCsp,
  filterRequestHeaders,
  filterResponseHeaders,
  isAppUrl,
  mimeFor,
  normalizeServerUrl,
  resolveStaticFile,
  toServerUrl,
} from './policy';

const PC_SERIAL_HEADER = 'x-mafk-pc-serial';
const SETTINGS_PATH = '/__desktop/settings.html';
/** The round sign-in badge the user sees first (rendered by the web app, only inside this shell). */
const LAUNCHER_PATH = '/launcher';
const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
/** The FZA logo, used for every window and the taskbar (replaces the default Electron icon). */
const APP_ICON = path.join(ASSETS_DIR, 'icon.png');
const webRoot = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', '..', 'web', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let config: DesktopConfig = { serverUrl: '' };
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let launcherWindow: BrowserWindow | null = null;
/** Resolves when the main window's page says the signed-in app is on screen (or after a safety timeout). */
let mainReady: Promise<void> = Promise.resolve();
let markMainReady: () => void = () => undefined;
const configFile = (): string => path.join(app.getPath('userData'), 'config.json');

const securityHeaders = (contentType: string): Record<string, string> => ({
  'content-type': contentType,
  'content-security-policy': buildCsp(),
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
});

const text = (status: number, body: string): Response =>
  new Response(body, { status, headers: securityHeaders('text/plain; charset=utf-8') });

const serveFile = async (file: string): Promise<Response> => {
  try {
    return new Response(await fs.promises.readFile(file), {
      headers: securityHeaders(mimeFor(file)),
    });
  } catch {
    return text(404, 'Not found');
  }
};

const isFile = async (file: string): Promise<boolean> => {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
};

const proxyToServer = async (request: Request): Promise<Response> => {
  const target = toServerUrl(config.serverUrl, request.url);
  if (!target) return text(404, 'Not found');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    // The body is read fully first and sent with a Content-Length. Streaming it (chunked) works on a plain
    // http:// server but can fail against https:// hosts such as Vercel, which made every POST (login) fail
    // with "cannot reach the server" while GET (health) worked.
    const body = hasBody ? await request.arrayBuffer() : undefined;
    // The server locks an ID to the PC it is bound to (Sale > User PC Serial). The serial is added HERE, by the shell,
    // replacing anything the page might have sent, so it always describes the computer the shell runs on.
    const headers = filterRequestHeaders(request.headers.entries()).filter(
      ([k]) => k.toLowerCase() !== PC_SERIAL_HEADER,
    );
    const serial = await getMachineSerial();
    if (serial) headers.push([PC_SERIAL_HEADER, serial]);
    const upstream = await net.fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined && body.byteLength > 0 ? { body } : {}),
      credentials: 'include',
      redirect: 'manual',
    } as RequestInit);
    return new Response(upstream.status === 204 ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filterResponseHeaders(upstream.headers.entries()),
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          code: 'SERVER_UNREACHABLE',
          message: `Cannot reach the server at ${config.serverUrl}. Check that it is running and the address is correct (File > Server settings).`,
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
};

const handleAppRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.host !== 'local') return text(404, 'Not found');
  if (url.pathname.startsWith('/api/')) return proxyToServer(request);
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');

  if (url.pathname.startsWith('/__desktop/')) {
    const file = resolveStaticFile(ASSETS_DIR, url.pathname.slice('/__desktop/'.length));
    const allowed =
      file !== null && (file.endsWith('settings.html') || file.endsWith('settings.js'));
    return allowed && file ? serveFile(file) : text(404, 'Not found');
  }

  const root = webRoot();
  const file = resolveStaticFile(root, url.pathname);
  if (!file) return text(404, 'Not found');
  if (await isFile(file)) return serveFile(file);
  // Single-page app: unknown paths without a file extension fall back to index.html; missing assets stay 404.
  if (path.extname(url.pathname) === '') return serveFile(path.join(root, 'index.html'));
  return text(404, 'Not found');
};

// ── Windows ────────────────────────────────────────────────────────────────────────────────────────────────────────
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  devTools: !app.isPackaged,
};

/** Smooth fade of a whole window (used for the hand-over from the sign-in badge to the app). */
const fadeWindow = (win: BrowserWindow, from: number, to: number, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const steps = Math.max(1, Math.round(ms / 16));
    let i = 0;
    const tick = setInterval(() => {
      i += 1;
      if (win.isDestroyed()) {
        clearInterval(tick);
        resolve();
        return;
      }
      win.setOpacity(from + (to - from) * Math.min(1, i / steps));
      if (i >= steps) {
        clearInterval(tick);
        resolve();
      }
    }, 16);
  });

/** The main application window. It stays invisible until the signed-in app is ready, then the caller fades it in. */
const createMainWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    opacity: 0,
    backgroundColor: '#050816',
    icon: APP_ICON,
    title: 'FZA Retail-POS',
    webPreferences,
  });
  mainWindow = win;
  mainReady = new Promise<void>((resolve) => {
    let done = false;
    markMainReady = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // Safety net: never leave the badge on screen forever if the page cannot report back.
    setTimeout(markMainReady, 9000);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // The signed-in session lives in the shared cookie jar, so the app restores it by itself.
  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
};

/** The round, frameless sign-in badge. Nothing else of the app is visible until the user has signed in. */
const createLauncher = (): void => {
  const win = new BrowserWindow({
    width: 640,
    height: 640,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    center: true,
    backgroundColor: '#00000000',
    icon: APP_ICON,
    title: 'FZA Retail-POS',
    webPreferences,
  });
  launcherWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (launcherWindow === win) launcherWindow = null;
  });
  void win.loadURL(`${APP_ORIGIN}${LAUNCHER_PATH}`);
};

/** Signed in on the badge: open the app behind it, wait until it is ready, then cross-fade badge -> app. */
const openAppFromLauncher = async (): Promise<void> => {
  if (mainWindow) return;
  const badge = launcherWindow;
  const win = createMainWindow();
  await mainReady;
  if (win.isDestroyed()) return;
  win.setOpacity(0);
  win.show();
  win.focus();
  await Promise.all([fadeWindow(win, 0, 1, 450), badge ? fadeWindow(badge, 1, 0, 450) : undefined]);
  badge?.close();
};

/** Signed out: close the app and bring the sign-in badge back. */
const backToLauncher = (): void => {
  if (!launcherWindow) createLauncher();
  mainWindow?.close();
};

const openSettings = (): void => {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Server settings',
    icon: APP_ICON,
    ...(mainWindow && !mainWindow.isDestroyed() ? { parent: mainWindow, modal: true } : {}),
    autoHideMenuBar: true,
    webPreferences,
  });
  settingsWindow.removeMenu();
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  void settingsWindow.loadURL(`${APP_ORIGIN}${SETTINGS_PATH}`);
};

// ── IPC (only the settings page may change the server address) ─────────────────────────────────────────────────────
const senderPath = (e: IpcMainInvokeEvent): string | null => {
  const url = e.senderFrame?.url ?? '';
  return isAppUrl(url) ? new URL(url).pathname : null;
};

const checkServer = async (origin: string): Promise<string | null> => {
  try {
    const res = await net.fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(5000),
      credentials: 'omit',
    });
    if (!res.ok)
      return `The server answered with status ${res.status}, so this is probably not the POS server.`;
    return null;
  } catch {
    return 'Cannot reach this address. Check the address, that the server is running, and the firewall.';
  }
};

ipcMain.handle('desktop:info', (e) => {
  if (!senderPath(e)) return null;
  return { version: app.getVersion(), platform: process.platform, serverUrl: config.serverUrl };
});
ipcMain.handle('desktop:get-serial', async (e) => {
  if (!senderPath(e)) return null;
  return getMachineSerial();
});
ipcMain.handle('desktop:open-settings', (e) => {
  if (!senderPath(e)) return;
  openSettings();
});
ipcMain.handle('desktop:set-server', async (e, input: unknown, force: unknown) => {
  if (senderPath(e) !== SETTINGS_PATH) return { ok: false, error: 'Not allowed.' };
  if (typeof input !== 'string') return { ok: false, error: 'Enter the server address.' };
  const parsed = normalizeServerUrl(input);
  if (!parsed.ok) return parsed;
  if (force !== true) {
    const problem = await checkServer(parsed.value);
    if (problem) return { ok: false, error: problem, canForce: true };
  }
  config = { serverUrl: parsed.value };
  saveConfig(configFile(), config);
  // A different server means a different login: drop the old session cookie, then reload the app.
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });
  (mainWindow ?? launcherWindow)?.webContents.reload();
  settingsWindow?.close();
  return { ok: true, value: parsed.value };
});
ipcMain.handle('desktop:launch-app', async (e) => {
  if (senderPath(e) !== LAUNCHER_PATH) return;
  await openAppFromLauncher();
});
ipcMain.handle('desktop:show-launcher', (e) => {
  if (senderPath(e) !== '/') return;
  backToLauncher();
});
ipcMain.handle('desktop:quit', (e) => {
  if (senderPath(e) !== LAUNCHER_PATH) return;
  app.quit();
});
ipcMain.on('desktop:app-ready', (e) => {
  if (mainWindow && e.sender === mainWindow.webContents) markMainReady();
});
ipcMain.handle('desktop:close-settings', (e) => {
  if (senderPath(e) !== SETTINGS_PATH) return;
  settingsWindow?.close();
});

// ── App wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
const buildMenu = (): void => {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Server settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About FZA Retail-POS',
              message: `FZA Retail-POS ${app.getVersion()}`,
              detail: `Server: ${config.serverUrl}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? launcherWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.mafk.retailflow');
    config = loadConfig(configFile());
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    protocol.handle(APP_SCHEME, handleAppRequest);
    buildMenu();
    createLauncher();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createLauncher();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
