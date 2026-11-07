import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplashScreen } from '../components/SplashScreen.js';
import { AuthProvider } from '../state/auth.js';
import { LoginPage } from '../LOGIN/LoginPage.js';
import { getRememberedClient, rememberClient } from '../state/clientIdentity.js';
import { validateLoginForm } from '../LOGIN/loginValidation.js';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Opening splash', () => {
  it('shows the logo image, then finishes by itself', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    expect(screen.getByAltText('MAFK Retail-Flow POS')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows the client name remembered on this computer', () => {
    rememberClient({ code: 'MTJ', name: 'MTJ Garments' });
    render(<SplashScreen onDone={() => undefined} />);
    expect(screen.getByText('MTJ')).toBeTruthy();
    expect(screen.getByText('MTJ Garments')).toBeTruthy();
  });

  it('shows no client name when none is remembered', () => {
    render(<SplashScreen onDone={() => undefined} />);
    expect(screen.queryByText('MTJ')).toBeNull();
  });

  it('a click or a key press skips it, once', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    fireEvent.click(screen.getByTestId('splash'));
    fireEvent.keyDown(window, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('Client on the sign-in screen', () => {
  const json = (status: number, body: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const install = (loginStatus = 200) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith('/auth/refresh'))
          return json(401, { error: { code: 'SESSION_REVOKED' } });
        if (path.endsWith('/auth/login')) {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return loginStatus === 200
            ? json(200, {
                accessToken: 'tok',
                user: {
                  id: 'u1',
                  tenantId: 't1',
                  loginId: 'ali',
                  displayName: 'Ali',
                  systemRole: 'CASHIER',
                  permissions: [],
                  client: { code: 'MTJ', name: 'MTJ Garments' },
                },
              })
            : json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'no' } });
        }
        return json(404, {});
      }),
    );
    return bodies;
  };

  const fill = async (client: string | null, loginId: string, password: string) => {
    const user = userEvent.setup();
    await screen.findByLabelText('Login ID');
    if (client !== null) {
      await user.clear(screen.getByLabelText('Client'));
      if (client) await user.type(screen.getByLabelText('Client'), client);
    }
    await user.type(screen.getByLabelText('Login ID'), loginId);
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('sends the client code, shows it prominently, and remembers the client after sign-in', async () => {
    const bodies = install();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await fill('mtj', 'ali', 'whatever-pass');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ loginId: 'ali', password: 'whatever-pass', clientCode: 'mtj' });
    await waitFor(() =>
      expect(getRememberedClient()).toEqual({ code: 'MTJ', name: 'MTJ Garments' }),
    );
  });

  it('shows the remembered client name before signing in, and pre-fills the field', async () => {
    install();
    rememberClient({ code: 'J.', name: 'J. Fashion' });
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await screen.findByLabelText('Login ID');
    expect(screen.getByTestId('client-banner').textContent).toBe('J.');
    expect(screen.getByText('J. Fashion')).toBeTruthy();
    expect((screen.getByLabelText('Client') as HTMLInputElement).value).toBe('J.');
  });

  it('leaving the client blank sends no client code (Master Admin sign-in)', async () => {
    const bodies = install();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await fill('', 'admin.root', 'whatever-pass');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ loginId: 'admin.root', password: 'whatever-pass' });
  });

  it('rejects a malformed client code before sending anything', async () => {
    const bodies = install();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    await fill('bad code!', 'ali', 'whatever-pass');
    await screen.findByText(/Client codes are 1–20 characters/);
    expect(bodies).toHaveLength(0);
  });

  it('validation accepts codes with a dot or dash and rejects spaces', () => {
    expect(validateLoginForm('ali.x', 'p', 'J.').clientCode).toBeUndefined();
    expect(validateLoginForm('ali.x', 'p', 'MTJ-2').clientCode).toBeUndefined();
    expect(validateLoginForm('ali.x', 'p', 'M TJ').clientCode).toBeDefined();
  });
});
