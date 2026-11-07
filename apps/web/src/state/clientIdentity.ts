/**
 * The client (brand) this computer last signed in to, e.g. MTJ. It is only a convenience for the sign-in screen and the
 * opening splash: it never grants access. The server decides which client an account belongs to and refuses any
 * sign-in whose client code does not match the account.
 */
export interface ClientIdentity {
  code: string;
  name: string;
}

const KEY = 'mafk.client';

export const CLIENT_CODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

export const getRememberedClient = (): ClientIdentity | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ClientIdentity>;
    return typeof v.code === 'string' &&
      typeof v.name === 'string' &&
      CLIENT_CODE_REGEX.test(v.code)
      ? { code: v.code, name: v.name }
      : null;
  } catch {
    return null;
  }
};

export const rememberClient = (client: ClientIdentity): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: client.code, name: client.name }));
  } catch {
    /* storage unavailable: the sign-in screen simply starts empty next time */
  }
};

export const forgetClient = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
