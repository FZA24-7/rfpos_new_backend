import type { AuthUser } from '../api/types.js';

/** True when the signed-in user holds the permission. A missing list means "nothing", never "everything". */
export const can = (user: AuthUser | null | undefined, key: string): boolean =>
  !!user?.permissions?.includes(key);

export const canAny = (user: AuthUser | null | undefined, keys: readonly string[]): boolean =>
  keys.some((k) => can(user, k));
