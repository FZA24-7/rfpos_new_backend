import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import splashImage from '../assets/splash.webp';
import { apiRequest } from '../api/client.js';
import type { LoginResponse } from '../api/types.js';
import { describeLoginError } from '../LOGIN/loginErrors.js';
import { validateLoginForm } from '../LOGIN/loginValidation.js';
import { getRememberedClient, rememberClient } from '../state/clientIdentity.js';

type Phase = 'form' | 'checking' | 'unlocking';

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The first thing the user sees when double-clicking the .exe: a round badge with the logo and the credentials.
 * Signing in here talks to the same login API as the normal sign-in page (the server still decides everything, and a
 * client code that does not match the account is refused). The session cookie is shared with the app window, which
 * is opened behind the badge once the credentials were accepted; the shell then cross-fades badge -> app.
 */
export const DesktopLauncher = () => {
  const [remembered] = useState(getRememberedClient);
  const [clientCode, setClientCode] = useState(remembered?.code ?? '');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; brand: string | null } | null>(null);
  const inFlight = useRef(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('launcher-mode');
    return () => document.documentElement.classList.remove('launcher-mode');
  }, []);

  useEffect(() => {
    if (phase === 'form' && error) {
      passwordRef.current?.focus();
    }
  }, [phase, error]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const problems = validateLoginForm(loginId, password, clientCode);
    const first = problems.clientCode ?? problems.loginId ?? problems.password;
    if (first) {
      setError(first);
      if (problems.loginId) loginRef.current?.focus();
      else if (problems.password) passwordRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setError(null);
    setPhase('checking');
    try {
      const code = clientCode.trim();
      const res = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: code
          ? { loginId: loginId.trim(), password, clientCode: code }
          : { loginId: loginId.trim(), password },
        skipAuthRetry: true,
      });
      if (res.user.client) rememberClient(res.user.client);
      setWelcome({
        name: res.user.displayName,
        brand: res.user.client ? `${res.user.client.name} (${res.user.client.code})` : null,
      });
      setPhase('unlocking');
      // Let the unlock animation play, then open the app behind the badge; the shell cross-fades to it.
      await new Promise((r) => setTimeout(r, reducedMotion() ? 250 : 1100));
      await window.mafkDesktop?.launchApp?.();
    } catch (err) {
      setPassword('');
      setPhase('form');
      setError(describeLoginError(err));
    } finally {
      inFlight.current = false;
    }
  };

  const busy = phase !== 'form';

  return (
    <div className="launcher-stage" data-testid="launcher">
      <div className={`launcher-badge ${phase === 'unlocking' ? 'launcher-unlock' : ''}`}>
        <div className="launcher-face">
          <img src={splashImage} alt="FZA Retail-POS" draggable={false} className="launcher-logo" />
          <div className="launcher-sweep" aria-hidden="true" />
          {phase === 'unlocking' ? (
            <div className="launcher-panel launcher-welcome" role="status" aria-live="polite">
              <p className="text-xs uppercase tracking-[0.3em] text-sky-200">Welcome</p>
              <p className="mt-1 text-xl font-semibold text-white">{welcome?.name}</p>
              {welcome?.brand ? (
                <p className="mt-1 text-sm text-slate-300">{welcome.brand}</p>
              ) : null}
              <p className="launcher-dots mt-3 text-sm text-slate-300">Opening your workspace</p>
            </div>
          ) : (
            <form className="launcher-panel" onSubmit={(e) => void submit(e)} aria-label="Sign in">
              <label className="launcher-row">
                <span>Client :</span>
                <input
                  aria-label="Client"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value.toUpperCase())}
                  autoFocus={!remembered}
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="e.g. MTJ"
                  disabled={busy}
                />
              </label>
              <label className="launcher-row">
                <span>User Name :</span>
                <input
                  aria-label="User name"
                  ref={loginRef}
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  autoFocus={Boolean(remembered)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
              <label className="launcher-row">
                <span>Password :</span>
                <input
                  aria-label="Password"
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                />
              </label>
              <p className="launcher-error" role="alert" aria-live="assertive">
                {error ?? ' '}
              </p>
              <div className="launcher-buttons">
                <button type="submit" disabled={busy}>
                  {phase === 'checking' ? 'Checking…' : 'Login'}
                </button>
                <button type="button" onClick={() => void window.mafkDesktop?.quit?.()}>
                  Exit
                </button>
              </div>
              <button
                type="button"
                className="launcher-link"
                onClick={() => void window.mafkDesktop?.openSettings?.()}
              >
                Server settings
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
