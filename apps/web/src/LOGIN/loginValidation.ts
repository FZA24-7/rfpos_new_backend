import { isValidLoginIdFormat } from '@mafk/shared';
import { CLIENT_CODE_REGEX } from '../state/clientIdentity.js';

export interface LoginFieldErrors {
  loginId?: string;
  password?: string;
  clientCode?: string;
}

/** Mirrors the server's `loginSchema` (non-empty, password <= 128) plus the shared Login ID format rule. */
export const validateLoginForm = (
  loginId: string,
  password: string,
  clientCode = '',
): LoginFieldErrors => {
  const errors: LoginFieldErrors = {};
  if (clientCode.trim() && !CLIENT_CODE_REGEX.test(clientCode.trim())) {
    errors.clientCode = 'Client codes are 1–20 characters: letters, numbers, dots or hyphens.';
  }
  const trimmed = loginId.trim();
  if (!trimmed) {
    errors.loginId = 'Enter your Login ID.';
  } else if (trimmed.length > 64 || !isValidLoginIdFormat(trimmed)) {
    errors.loginId =
      'Login IDs are 3–32 characters: letters, numbers, dots, underscores or hyphens.';
  }
  if (!password) {
    errors.password = 'Enter your password.';
  } else if (password.length > 128) {
    errors.password = 'Password is too long.';
  }
  return errors;
};
