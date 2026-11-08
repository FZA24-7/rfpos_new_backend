import { Router } from 'express';
import { z } from 'zod';
import {
  adminUserListQuerySchema,
  createAdminUserSchema,
  idParamSchema,
  updateAdminUserSchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createMasterUserAdminController } from '../controllers/master-user-admin.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import { requirePlatformActor } from '../middleware/require-platform-actor.js';

type Controller = ReturnType<typeof createMasterUserAdminController>;
const userParams = z.object({ id: z.string().trim().min(1), userId: z.string().trim().min(1) });

/** Master Admin: full Security File management (users, details, module/form/report rights) for ANY client. */
export const masterUserAdminRoutes = (c: Controller, accessTokens: AccessTokenService): Router => {
  const router = Router();
  router.use('/master/user-admin', requireAuth(accessTokens), requirePlatformActor);
  router.use('/master/tenants/:id/user-admin', requireAuth(accessTokens), requirePlatformActor);

  router.get('/master/user-admin/registry', requirePermission('users.view'), c.registry);

  const base = '/master/tenants/:id/user-admin';
  router.get(
    `${base}/lookups`,
    requirePermission('users.view'),
    validate(idParamSchema, 'params'),
    c.lookups,
  );
  router.get(
    `${base}/users`,
    requirePermission('users.view'),
    validate(idParamSchema, 'params'),
    validate(adminUserListQuerySchema, 'query'),
    c.listUsers,
  );
  router.post(
    `${base}/users`,
    requirePermission('users.manage'),
    validate(idParamSchema, 'params'),
    validate(createAdminUserSchema),
    c.createUser,
  );
  router.get(
    `${base}/users/:userId`,
    requirePermission('users.view'),
    validate(userParams, 'params'),
    c.getUser,
  );
  router.patch(
    `${base}/users/:userId`,
    requirePermission('users.manage'),
    validate(userParams, 'params'),
    validate(updateAdminUserSchema),
    c.updateUser,
  );
  router.delete(
    `${base}/users/:userId`,
    requirePermission('users.manage'),
    validate(userParams, 'params'),
    c.deleteUser,
  );
  return router;
};
