import { Router } from 'express';
import {
  adminUserListQuerySchema,
  attributeLocksSchema,
  closePeriodSchema,
  createAdminUserSchema,
  generateOverheadSchema,
  idParamSchema,
  logQuerySchema,
  updateAdminUserSchema,
  updateLocationStatusSchema,
  updateUserCategorySchema,
  updateUserLocationSchema,
  userCategorySchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createAdminController } from '../controllers/admin.controller.js';
import { requireAuth } from '../middleware/require-auth.js';
import {
  requireAnyPermission,
  requirePermission,
  requireTenant,
} from '../middleware/require-permission.js';
import { validate } from '../middleware/validate.js';

type AdminController = ReturnType<typeof createAdminController>;

/**
 * Every Administrator route is tenant-scoped and guarded by the permission of the form it belongs to
 * (security_file.*, user_category.* ...). Those are the same keys the Security File grants per user.
 */
export const adminRoutes = (c: AdminController, accessTokens: AccessTokenService): Router => {
  const router = Router();
  router.use('/admin', requireAuth(accessTokens), requireTenant);
  const id = validate(idParamSchema, 'params');
  const log = validate(logQuerySchema, 'query');

  // Security File (the registry is also needed by Update User Location's user picker, so any admin form may read it)
  router.get('/admin/registry', requirePermission('security_file.view'), c.registry);
  router.get(
    '/admin/security/lookups',
    requireAnyPermission('security_file.view', 'user_location.view'),
    c.lookups,
  );
  router.get(
    '/admin/users',
    requireAnyPermission('security_file.view', 'user_location.view'),
    validate(adminUserListQuerySchema, 'query'),
    c.listUsers,
  );
  router.post(
    '/admin/users',
    requirePermission('security_file.create'),
    validate(createAdminUserSchema),
    c.createUser,
  );
  router.get('/admin/users/:id', requirePermission('security_file.view'), id, c.getUser);
  router.patch(
    '/admin/users/:id',
    requirePermission('security_file.edit'),
    id,
    validate(updateAdminUserSchema),
    c.updateUser,
  );
  router.delete('/admin/users/:id', requirePermission('security_file.delete'), id, c.deleteUser);

  // User Category
  router.get('/admin/user-categories', requirePermission('user_category.view'), c.listCategories);
  router.post(
    '/admin/user-categories',
    requirePermission('user_category.create'),
    validate(userCategorySchema),
    c.createCategory,
  );
  router.patch(
    '/admin/user-categories/:id',
    requirePermission('user_category.edit'),
    id,
    validate(updateUserCategorySchema),
    c.updateCategory,
  );
  router.delete(
    '/admin/user-categories/:id',
    requirePermission('user_category.delete'),
    id,
    c.deleteCategory,
  );

  // Update User Location
  router.patch(
    '/admin/users/:id/location',
    requirePermission('user_location.edit'),
    id,
    validate(updateUserLocationSchema),
    c.updateUserLocation,
  );

  // Attribute Locking
  router.get('/admin/attribute-locks', requirePermission('attribute_locking.view'), c.getLocks);
  router.put(
    '/admin/attribute-locks',
    requirePermission('attribute_locking.edit'),
    validate(attributeLocksSchema),
    c.setLocks,
  );

  // Close Period for Transaction
  router.get('/admin/period', requirePermission('period_close.view'), c.getPeriod);
  router.post(
    '/admin/period',
    requirePermission('period_close.create'),
    validate(closePeriodSchema),
    c.closePeriod,
  );
  router.delete('/admin/period', requirePermission('period_close.delete'), c.reopenPeriod);

  // Logs
  router.get('/admin/logs/audit', requirePermission('log_file.view'), log, c.auditLog);
  router.get('/admin/logs/sms', requirePermission('sms_log.view'), log, c.smsLog);
  router.get('/admin/logs/bank', requirePermission('bank_log.view'), log, c.bankLog);

  // Generate Overhead
  router.get('/admin/overhead', requirePermission('overhead.view'), c.listOverhead);
  router.post(
    '/admin/overhead',
    requirePermission('overhead.create'),
    validate(generateOverheadSchema),
    c.generateOverhead,
  );
  router.delete('/admin/overhead/:id', requirePermission('overhead.delete'), id, c.deleteOverhead);

  // Locations Status
  router.get('/admin/locations', requirePermission('location_status.view'), c.listLocations);
  router.patch(
    '/admin/locations/:id',
    requirePermission('location_status.edit'),
    id,
    validate(updateLocationStatusSchema),
    c.setLocationActive,
  );

  return router;
};
