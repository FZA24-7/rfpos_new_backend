import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopLauncher } from '../desktop/DesktopLauncher.js';
import { isLauncherRoute } from '../desktop/launcher.js';
import { AuthProvider, useAuth } from '../state/auth.js';

/** The round sign-in badge of the desktop shell: sign-in, error handling, hand-over to the app window, sign-out. */

const USER = {
  id: 'u1',
  tenantId: 't1',
  loginId: 'faraz.ahmed',
  displayName: 'Faraz Ahmed',
  systemRole: 'CASHIER',
  client: { code: 'MTJ', name: 'MTJ Retail' },
};
const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Bridge {
  isDesktop: true;
  apiBase: string;
  launchApp: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  openSettings: ReturnType<typeof vi.fn>;
  showLauncher: ReturnType<typeof vi.fn>;
  appReady: ReturnType<typeof vi.fn>;
}
let bridge: Bridge;
let logins: Record<string, unknown>[];

beforeEach(() => {
  logins = [];
  bridge = {
    isDesktop: true,
    apiBase: '/api',
    launchApp: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    openSettings: vi.fn(async () => undefined),
    showLauncher: vi.fn(async () => undefined),
    appReady: vi.fn(),
  };
  (window as { mafkDesktop?: unknown }).mafkDesktop = bridge;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.endsWith('/auth/login')) {
        logins.push(body);
        return body.password === 'right-pass'
          ? json(200, { accessToken: 'tok', user: USER })
          : json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'no' } });
      }
      if (url.endsWith('/auth/logout')) return json(204, undefined);
      return json(401, {});
    }),
  );
});
afterEach(() => {
  cleanup();
  delete (window as { mafkDesktop?: unknown }).mafkDesktop;
  window.history.pushState({}, '', '/');
  document.documentElement.classList.remove('launcher-mode');
});

describe('desktop sign-in badge', () => {
  it('is only used in the desktop shell on /launcher', () => {
    expect(isLauncherRoute()).toBe(false);
    window.history.pushState({}, '', '/launcher');
    expect(isLauncherRoute()).toBe(true);
    delete (window as { mafkDesktop?: unknown }).mafkDesktop;
    expect(isLauncherRoute()).toBe(false);
  });

  it('signs in with client, user and password, welcomes the user, then opens the app', async () => {
    const user = userEvent.setup();
    render(<DesktopLauncher />);
    expect(document.documentElement.classList.contains('launcher-mode')).toBe(true);
    await user.type(screen.getByLabelText('Client'), 'mtj');
    await user.type(screen.getByLabelText('User name'), 'faraz.ahmed');
    await user.type(screen.getByLabelText('Password'), 'right-pass{enter}');
    await screen.findByText('Faraz Ahmed');
    expect(screen.getByText('MTJ Retail (MTJ)')).toBeTruthy();
    expect(logins).toEqual([{ loginId: 'faraz.ahmed', password: 'right-pass', clientCode: 'MTJ' }]);
    await waitFor(() => expect(bridge.launchApp).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // the brand is remembered for the next launch
    expect(localStorage.getItem('mafk.client')).toContain('MTJ');
  });

  it('a wrong password stays on the badge with a message and never opens the app', async () => {
    const user = userEvent.setup();
    render(<DesktopLauncher />);
    await user.type(screen.getByLabelText('Client'), 'MTJ');
    await user.type(screen.getByLabelText('User name'), 'faraz.ahmed');
    await user.type(screen.getByLabelText('Password'), 'bad{enter}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid Login ID or password/);
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(bridge.launchApp).not.toHaveBeenCalled();
  });

  it('checks the fields before calling the server', async () => {
    const user = userEvent.setup();
    render(<DesktopLauncher />);
    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter your Login ID/);
    expect(logins).toHaveLength(0);
  });

  it('Exit closes the software and Server settings opens the settings window', async () => {
    const user = userEvent.setup();
    render(<DesktopLauncher />);
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(bridge.quit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Server settings' }));
    expect(bridge.openSettings).toHaveBeenCalled();
  });

  it('starts on the user field when this computer already knows the client', () => {
    localStorage.setItem('mafk.client', JSON.stringify({ code: 'MTJ', name: 'MTJ Retail' }));
    render(<DesktopLauncher />);
    expect((screen.getByLabelText('Client') as HTMLInputElement).value).toBe('MTJ');
    expect(document.activeElement).toBe(screen.getByLabelText('User name'));
  });
});

describe('signing out of the app (desktop shell)', () => {
  it('asks the shell to bring the sign-in badge back', async () => {
    const Probe = () => {
      const { logout } = useAuth();
      return <button onClick={() => void logout()}>out</button>;
    };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {
      screen.getByText('out').click();
    });
    await waitFor(() => expect(bridge.showLauncher).toHaveBeenCalledTimes(1));
  });
});
