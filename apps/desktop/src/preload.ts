// Runs in the sandboxed renderer before the page. Exposes a tiny, fixed API; the page never gets Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mafkDesktop', {
  isDesktop: true,
  /** The app is served from mafk-app://local, so the API is same-origin; the main process forwards it to the server. */
  apiBase: '/api',
  getInfo: (): Promise<unknown> => ipcRenderer.invoke('desktop:info'),
  /** The serial number of this computer (Sale > User PC Serial > Get Serial); null when it cannot be read. */
  getSerial: (): Promise<string | null> => ipcRenderer.invoke('desktop:get-serial'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('desktop:open-settings'),
  setServer: (address: string, force?: boolean): Promise<unknown> =>
    ipcRenderer.invoke('desktop:set-server', address, force === true),
  closeSettings: (): Promise<void> => ipcRenderer.invoke('desktop:close-settings'),
  /** Sign-in badge only: open the app (resolves once it is on screen). */
  launchApp: (): Promise<void> => ipcRenderer.invoke('desktop:launch-app'),
  /** App only: after signing out, go back to the sign-in badge. */
  showLauncher: (): Promise<void> => ipcRenderer.invoke('desktop:show-launcher'),
  /** Sign-in badge only: close the software. */
  quit: (): Promise<void> => ipcRenderer.invoke('desktop:quit'),
  /** App only: tell the shell the signed-in app is ready to be shown. */
  appReady: (): void => ipcRenderer.send('desktop:app-ready'),
});
