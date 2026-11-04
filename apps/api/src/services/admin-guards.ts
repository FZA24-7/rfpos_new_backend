// Server-side enforcement of the two Administrator switches that other modules must respect:
//  - Close Period for Transaction: nothing dated on or before the closed day may be added or changed.
//  - Attribute Locking: a locked attribute of an existing record cannot be changed.
import { compareDecimalStrings, localDateString, LOCKABLE_ATTRIBUTES } from '@mafk/shared';
import type { Repositories } from '../domain/ports.js';
import { DomainError } from '../domain/types.js';

export const PERIOD_SETTING_KEY = 'admin.closed_through';
export const LOCKS_SETTING_KEY = 'admin.attribute_locks';

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const getClosedThrough = async (
  repos: Repositories,
  tenantId: string,
): Promise<string | null> => {
  const v = (await repos.admin.getSetting(tenantId, PERIOD_SETTING_KEY)) as {
    closedThrough?: unknown;
  } | null;
  return v && isYmd(v.closedThrough) ? v.closedThrough : null;
};

export const getTenantTimeZone = async (repos: Repositories, tenantId: string): Promise<string> =>
  (await repos.tenants.findDetailById(tenantId))?.timezone ?? 'Asia/Karachi';

/** `days` are business-time-zone dates (YYYY-MM-DD). Pass `'today'` for documents created right now. */
export const assertPeriodOpen = async (
  repos: Repositories,
  tenantId: string,
  ...days: (string | 'today')[]
): Promise<void> => {
  const closed = await getClosedThrough(repos, tenantId);
  if (!closed) return;
  const tz = await getTenantTimeZone(repos, tenantId);
  for (const d of days) {
    const day = d === 'today' ? localDateString(new Date(), tz) : d;
    if (day <= closed) {
      throw new DomainError(
        'PERIOD_CLOSED',
        `The period up to ${closed} is closed. Transactions dated ${day} cannot be added or changed. An administrator can re-open it under Administrator > Close Period for Transaction.`,
        409,
      );
    }
  }
};

export const getLockedAttributes = async (
  repos: Repositories,
  tenantId: string,
): Promise<Set<string>> => {
  const v = (await repos.admin.getSetting(tenantId, LOCKS_SETTING_KEY)) as {
    locks?: unknown;
  } | null;
  return new Set(
    Array.isArray(v?.locks)
      ? ((v!.locks as unknown[]).filter((x) => typeof x === 'string') as string[])
      : [],
  );
};

const PRODUCT_FIELD_TO_ATTRIBUTE: Record<string, string> = {
  name: 'product.name',
  categoryId: 'product.category',
  subDepartmentId: 'product.sub_department',
  brandId: 'product.brand',
  supplierId: 'product.supplier',
  costPrice: 'product.cost_price',
  sellingPrice: 'product.selling_price',
  wholesalePrice: 'product.wholesale_price',
  taxRate: 'product.tax_rate',
  unit: 'product.unit',
  minStock: 'product.stock_limits',
  maxStock: 'product.stock_limits',
};
const DECIMAL_FIELDS = new Set([
  'costPrice',
  'sellingPrice',
  'wholesalePrice',
  'taxRate',
  'minStock',
  'maxStock',
]);

const differs = (field: string, before: unknown, after: unknown): boolean => {
  if (DECIMAL_FIELDS.has(field)) {
    if (before === null || before === undefined || after === null || after === undefined)
      return (before ?? null) !== (after ?? null);
    try {
      return compareDecimalStrings(String(before), String(after)) !== 0;
    } catch {
      return String(before) !== String(after);
    }
  }
  return (before ?? null) !== (after ?? null);
};

/** Rejects a product change that touches a locked attribute. Unchanged values never count as a change. */
export const assertProductAttributesUnlocked = async (
  repos: Repositories,
  tenantId: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<void> => {
  const locked = await getLockedAttributes(repos, tenantId);
  if (locked.size === 0) return;
  const hit = new Set<string>();
  for (const [field, attr] of Object.entries(PRODUCT_FIELD_TO_ATTRIBUTE)) {
    if (!(field in patch) || patch[field] === undefined) continue;
    if (locked.has(attr) && differs(field, before[field], patch[field])) hit.add(attr);
  }
  if (hit.size > 0) {
    const labels = [...hit].map((k) => LOCKABLE_ATTRIBUTES.find((a) => a.key === k)?.label ?? k);
    throw new DomainError(
      'ATTRIBUTE_LOCKED',
      `Locked: ${labels.join(', ')}. An administrator can unlock it under Administrator > Attribute Locking.`,
      409,
    );
  }
};
