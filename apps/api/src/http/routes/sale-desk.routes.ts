import { Router } from 'express';
import { SALE_DESK_RESOURCES, SALE_REPORT_PERMISSIONS } from '@mafk/shared';
import {
  cashActivityListQuerySchema,
  cashActivityQuerySchema,
  clearClosingSchema,
  deskBillListQuerySchema,
  deskBillParamSchema,
  deskBillWiseQuerySchema,
  deskDailyClosingQuerySchema,
  deskSalesPersonQuerySchema,
  fbrListQuerySchema,
  fbrRepostSchema,
  idParamSchema,
  pcSerialSchema,
  repostCashSchema,
  saveCashActivitySchema,
  shopRegionSchema,
  updateTenderSchema,
  userIdParamSchema,
} from '@mafk/validation';
import type { AccessTokenService } from '../../security/jwt.js';
import type { createSaleDeskController } from '../controllers/sale-desk.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/require-auth.js';
import {
  requireAnyPermission,
  requirePermission,
  requireTenant,
} from '../middleware/require-permission.js';

type Controller = ReturnType<typeof createSaleDeskController>;

export const saleDeskRoutes = (
  controller: Controller,
  accessTokens: AccessTokenService,
): Router => {
  const router = Router();
  router.use('/sale-desk', requireAuth(accessTokens), requireTenant);

  // Drop-down data for every Sale-menu screen: open to anyone who may open at least one of them (or the POS).
  router.get(
    '/sale-desk/lookups',
    requireAnyPermission(
      'pos.view',
      ...SALE_DESK_RESOURCES.map((r) => `${r}.view`),
      ...SALE_REPORT_PERMISSIONS,
    ),
    controller.lookups,
  );
  router.put(
    '/sale-desk/shops/:id/region',
    requirePermission('settings.edit'),
    validate(idParamSchema, 'params'),
    validate(shopRegionSchema),
    controller.setShopRegion,
  );

  // reports
  router.get(
    '/sale-desk/reports/daily-closing',
    requirePermission('sale_reports.daily_closing'),
    validate(deskDailyClosingQuerySchema, 'query'),
    controller.dailyClosing,
  );
  router.get(
    '/sale-desk/reports/bill-wise',
    requirePermission('sale_reports.bill_wise'),
    validate(deskBillWiseQuerySchema, 'query'),
    controller.billWise,
  );
  router.get(
    '/sale-desk/reports/sales-person',
    requirePermission('sale_reports.sales_person'),
    validate(deskSalesPersonQuerySchema, 'query'),
    controller.salesPerson,
  );

  // Daily Cash Activity
  router.get(
    '/sale-desk/cash-activity',
    requirePermission('cash_activity.view'),
    validate(cashActivityQuerySchema, 'query'),
    controller.cashActivity,
  );
  router.get(
    '/sale-desk/cash-activity/list',
    requirePermission('cash_activity.view'),
    validate(cashActivityListQuerySchema, 'query'),
    controller.listCashActivities,
  );
  router.put(
    '/sale-desk/cash-activity',
    requireAnyPermission('cash_activity.create', 'cash_activity.edit'),
    validate(saveCashActivitySchema),
    controller.saveCashActivity,
  );
  router.post(
    '/sale-desk/cash-activity/clear-closing',
    requirePermission('cash_activity.delete'),
    validate(clearClosingSchema),
    controller.clearClosing,
  );
  router.post(
    '/sale-desk/cash-activity/repost',
    requirePermission('cash_activity.edit'),
    validate(repostCashSchema),
    controller.repostCash,
  );

  // Cash and Credit Card Update
  router.get(
    '/sale-desk/bills',
    requirePermission('card_update.view'),
    validate(deskBillListQuerySchema, 'query'),
    controller.listBills,
  );
  router.get(
    '/sale-desk/bills/:id/tender',
    requirePermission('card_update.view'),
    validate(deskBillParamSchema, 'params'),
    controller.getTender,
  );
  router.put(
    '/sale-desk/bills/:id/tender',
    requirePermission('card_update.edit'),
    validate(deskBillParamSchema, 'params'),
    validate(updateTenderSchema),
    controller.updateTender,
  );

  // FBR Repost Period
  router.get(
    '/sale-desk/fbr',
    requirePermission('fbr_repost.view'),
    validate(fbrListQuerySchema, 'query'),
    controller.fbrList,
  );
  router.post(
    '/sale-desk/fbr/repost',
    requirePermission('fbr_repost.edit'),
    validate(fbrRepostSchema),
    controller.fbrRepost,
  );

  // User PC Serial
  router.get('/sale-desk/pc-serials', requirePermission('pc_serial.view'), controller.listSerials);
  router.put(
    '/sale-desk/pc-serials/:userId',
    requirePermission('pc_serial.edit'),
    validate(userIdParamSchema, 'params'),
    validate(pcSerialSchema),
    controller.setSerial,
  );

  return router;
};
