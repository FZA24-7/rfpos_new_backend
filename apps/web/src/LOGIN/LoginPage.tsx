import { useState } from 'react';
import { useAuth } from '../state/auth.js';
import { getRememberedClient } from '../state/clientIdentity.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { LoginForm } from './LoginForm.js';

/** Full-page sign-in screen. Shown by `App` whenever there is no authenticated session. */
export const LoginPage = () => {
  const { login } = useAuth();
  const [remembered] = useState(getRememberedClient);
  const [typed, setTyped] = useState(remembered?.code ?? '');
  const code = typed.trim().toUpperCase();
  // The full brand name is known only for the client this computer last signed in to.
  const brandName = remembered && remembered.code.toUpperCase() === code ? remembered.name : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {code ? (
            <div aria-live="polite">
              <p
                data-testid="client-banner"
                className="text-4xl font-bold tracking-[0.25em] text-brand-600 dark:text-brand-300"
              >
                {code}
              </p>
              {brandName ? (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{brandName}</p>
              ) : null}
            </div>
          ) : null}
          <h1 className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">
            FZA Retail-POS
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        </div>
        <Card>
          <CardBody>
            <LoginForm
              onSubmit={login}
              onClientChange={setTyped}
              initialClientCode={remembered?.code ?? ''}
            />
          </CardBody>
        </Card>
      </div>
    </main>
  );
};
