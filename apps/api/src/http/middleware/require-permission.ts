import type { NextFunction, Request, Response } from 'express';
<<<<<<< HEAD
import { hasAllPermissions, hasAnyPermission } from '../../rbac/check.js';
=======
import { hasAllPermissions } from '../../rbac/check.js';
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3

/**
 * Enforces permissions on the SERVER, as required by the spec - never trust a
 * frontend-only check. Must run after `requireAuth`.
 */
export const requirePermission =
  (...required: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
      return;
    }
    if (!hasAllPermissions(req.auth.permissions, required)) {
      res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' } });
      return;
    }
    next();
  };

/** Requires the caller to belong to a tenant (i.e. rejects platform-level Master Admin tokens). */
export const requireTenant = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth) {
    res
      .status(401)
      .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
    return;
  }
  if (!req.auth.tenantId) {
    res.status(403).json({
      error: { code: 'TENANT_REQUIRED', message: 'This action requires a tenant context.' },
    });
    return;
  }
  next();
};
<<<<<<< HEAD

/**
 * Passes when the caller holds ANY of the listed permissions. Used where a screen is reachable both by a shared role
 * (one broad permission, e.g. `reports.view`) and by a per-user grant of one specific item (e.g. `reports.daily`).
 */
export const requireAnyPermission =
  (...anyOf: readonly string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
      return;
    }
    if (!hasAnyPermission(req.auth.permissions, anyOf)) {
      res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' } });
      return;
    }
    next();
  };
=======
>>>>>>> de44982ecba1541fc115d205eecbf37b454479f3
