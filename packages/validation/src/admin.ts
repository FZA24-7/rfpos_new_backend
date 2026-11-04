import { z } from 'zod';
import { RIGHTS } from '@mafk/shared';
import { loginIdSchema, passwordSchema } from './auth.js';

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v));

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

const idString = z.string().trim().min(1).max(64);

/** Rights as the Security File screen sends them: modules + per-item ticked rights. */
export const rightsSelectionSchema = z.object({
  modules: z.array(z.string().trim().min(1).max(40)).max(50),
  items: z.record(z.string().trim().min(1).max(60), z.array(z.enum(RIGHTS)).max(4)),
});

const profileFields = {
  fbrPosId: nullableText(60),
  macAddress: nullableText(40),
  userCategoryId: idString.nullable().optional(),
  counterPos: nullableText(60),
  port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  /** Omit to keep the stored token; send "" to clear it. */
  fbrToken: nullableText(2000),
  pcSerial: nullableText(120),
  storeId: idString.nullable().optional(),
};

export const createAdminUserSchema = z.object({
  loginId: loginIdSchema,
  displayName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  ...profileFields,
  rights: rightsSelectionSchema,
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  /** Omit to keep the current password. */
  password: passwordSchema.optional(),
  ...profileFields,
  rights: rightsSelectionSchema.optional(),
});
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  includeDisabled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const userCategorySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, "-" or "_".')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().optional(),
});
export type UserCategoryInput = z.infer<typeof userCategorySchema>;
export const updateUserCategorySchema = userCategorySchema.partial();

export const updateUserLocationSchema = z.object({ storeId: idString });
export const updateLocationStatusSchema = z.object({ isActive: z.boolean() });

export const attributeLocksSchema = z.object({
  locks: z.array(z.string().trim().min(1).max(60)).max(100),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
export const closePeriodSchema = z.object({ closedThrough: ymd });

export const generateOverheadSchema = z
  .object({ from: ymd, to: ymd, notes: optText(300) })
  .refine((v) => v.from <= v.to, { message: 'From must not be after To.', path: ['to'] });
export type GenerateOverheadInput = z.infer<typeof generateOverheadSchema>;

export const logQuerySchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type LogQuery = z.infer<typeof logQuerySchema>;
