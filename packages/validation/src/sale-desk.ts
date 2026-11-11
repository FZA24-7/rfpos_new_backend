import { z } from 'zod';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,2})?$/, 'Amount must be a plain number with at most 2 decimals');
const text = (max: number) => z.string().trim().max(max);
const id = z.string().trim().min(1).max(64);

const rangeShape = {
  from: ymd,
  to: ymd,
  storeId: id.optional(),
};
const orderedRange = <T extends { from: string; to: string }>(v: T) => v.from <= v.to;
const rangeMsg = { message: 'The "from" date must not be after the "to" date.' };

export const deskDailyClosingQuerySchema = z
  .object({
    ...rangeShape,
    salesman: text(60).optional(),
    type: z.enum(['summary', 'detail']).default('summary'),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine(orderedRange, rangeMsg);
export type DeskDailyClosingQuery = z.infer<typeof deskDailyClosingQuerySchema>;

export const deskBillWiseQuerySchema = z
  .object({
    ...rangeShape,
    region: text(60).optional(),
    type: z.enum(['summary', 'detail']).default('summary'),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine(orderedRange, rangeMsg);
export type DeskBillWiseQuery = z.infer<typeof deskBillWiseQuerySchema>;

export const deskSalesPersonQuerySchema = z
  .object({
    ...rangeShape,
    salesman: text(60).optional(),
    type: z.enum(['day-wise', 'consolidated', 'shop-wise', 'cashier-wise', 'consolidated-summary']),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine(orderedRange, rangeMsg);
export type DeskSalesPersonQuery = z.infer<typeof deskSalesPersonQuerySchema>;

// ── Daily Cash Activity ──
export const cashActivityQuerySchema = z.object({ storeId: id, date: ymd });
export type CashActivityQuery = z.infer<typeof cashActivityQuerySchema>;

export const cashActivityListQuerySchema = z
  .object({ storeId: id, from: ymd, to: ymd })
  .refine(orderedRange, rangeMsg);
export type CashActivityListQuery = z.infer<typeof cashActivityListQuerySchema>;

const expenseLine = z.object({
  head: text(60).min(1),
  description: text(120).default(''),
  amount: money,
});
const receiptLine = z.object({ head: text(60).min(1), amount: money });
const transferLine = z.object({
  type: text(60).min(1),
  remarks: text(120).default(''),
  amount: money,
});
const terminalLine = z.object({
  terminal: text(60).min(1),
  gtech: money.default('0'),
  settlement: money.default('0'),
  batch: text(40).default(''),
});

export const saveCashActivitySchema = z.object({
  storeId: id,
  date: ymd,
  receivePettyCash: money.default('0'),
  expenseLines: z.array(expenseLine).max(200).default([]),
  receiptLines: z.array(receiptLine).max(200).default([]),
  transferLines: z.array(transferLine).max(200).default([]),
  terminalLines: z.array(terminalLine).max(200).default([]),
  /** true = also close the day (locks it and issues the voucher number). */
  close: z.boolean().default(false),
});
export type SaveCashActivityInput = z.infer<typeof saveCashActivitySchema>;

export const clearClosingSchema = z.object({ storeId: id, date: ymd });
export type ClearClosingInput = z.infer<typeof clearClosingSchema>;

export const repostCashSchema = z
  .object({ storeId: id, from: ymd, to: ymd })
  .refine(orderedRange, rangeMsg);
export type RepostCashInput = z.infer<typeof repostCashSchema>;

// ── Cash and Credit Card Update ──
export const deskBillListQuerySchema = z.object({
  storeId: id,
  date: ymd,
  search: text(60).optional(),
});
export type DeskBillListQuery = z.infer<typeof deskBillListQuerySchema>;

export const deskBillParamSchema = z.object({ id });

export const updateTenderSchema = z.object({
  cash: money.default('0'),
  card: money.default('0'),
  onAccount: money.default('0'),
  customerId: id.optional(),
  terminal: text(40).default(''),
  fbrInvoiceNo: text(60).default(''),
});
export type UpdateTenderInput = z.infer<typeof updateTenderSchema>;

// ── FBR Repost Period ──
export const fbrListQuerySchema = z
  .object({
    ...rangeShape,
    status: z.enum(['all', 'pending', 'posted']).default('pending'),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine(orderedRange, rangeMsg);
export type FbrListQuery = z.infer<typeof fbrListQuerySchema>;

export const fbrRepostSchema = z.object({
  items: z
    .array(z.object({ saleId: id, fbrInvoiceNo: text(60) }))
    .min(1)
    .max(500),
});
export type FbrRepostInput = z.infer<typeof fbrRepostSchema>;

// ── Shops / regions / PC serial ──
export const shopRegionSchema = z.object({ region: text(60).default('') });
export const userIdParamSchema = z.object({ userId: id });
export const pcSerialSchema = z.object({ serial: text(80).default('') });
export type PcSerialInput = z.infer<typeof pcSerialSchema>;
