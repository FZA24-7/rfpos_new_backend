// The other Administrator modules: User Category, Update User Location, Attribute Locking, Close Period,
// Log File, Generate Overhead, Locations Status, SMS Log, Bank Log.
import {
  isLockableAttribute,
  LOCKABLE_ATTRIBUTES,
  localDateString,
  localDayRange,
} from '@mafk/shared';
import type { GenerateOverheadInput, LogQuery, UserCategoryInput } from '@mafk/validation';
import type {
  AuditRow,
  BankLogRow,
  OverheadRunRow,
  SmsLogRow,
  StoreStatusRow,
  UserCategoryRow,
} from '../domain/admin.js';
import type { Repositories } from '../domain/ports.js';
import { DomainError } from '../domain/types.js';
import {
  getClosedThrough,
  getLockedAttributes,
  getTenantTimeZone,
  LOCKS_SETTING_KEY,
  PERIOD_SETTING_KEY,
} from './admin-guards.js';

export interface OpsActor {
  id: string;
  tenantId: string;
}

const DEFAULT_CATEGORIES = [
  { code: 'DATA_ENTRY', name: 'Data Entry User' },
  { code: 'SUPERVISOR', name: 'Supervisor' },
  { code: 'CASHIER', name: 'Cashier' },
] as const;

/** a*100/b with 4 decimals, using integers only (no floating point money). Both inputs are non-negative decimals. */
export const percentOf = (numerator: string, denominator: string): string => {
  const scaled = (v: string): bigint => {
    const [whole = '0', frac = ''] = v.replace('-', '').split('.');
    return BigInt(whole + frac.padEnd(3, '0').slice(0, 3));
  };
  const n = scaled(numerator);
  const d = scaled(denominator);
  if (d === 0n) throw new Error('denominator is zero');
  // percent = n/d*100, kept at 4 decimals and rounded half up.
  const x = (n * 1_000_000n * 2n + d) / (d * 2n);
  const whole = x / 10_000n;
  const frac = (x % 10_000n).toString().padStart(4, '0');
  return `${whole}.${frac}`;
};

export class AdminOperationsService {
  constructor(private readonly repos: Repositories) {}

  private async audit(
    actor: OpsActor,
    action: string,
    entity: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action,
      entity,
      entityId,
      metadata,
    });
  }

  // ── User Category ───────────────────────────────────────────────────────────────────────────────────────────────
  async listCategories(tenantId: string): Promise<UserCategoryRow[]> {
    let rows = await this.repos.admin.listCategories(tenantId);
    if (rows.length === 0) {
      // Starting set for a business that has none yet; every entry can be renamed, disabled or deleted.
      for (const c of DEFAULT_CATEGORIES) {
        try {
          await this.repos.admin.createCategory(tenantId, { ...c, isActive: true });
        } catch {
          // a concurrent request created it first
        }
      }
      rows = await this.repos.admin.listCategories(tenantId);
    }
    return rows;
  }

  async createCategory(actor: OpsActor, input: UserCategoryInput): Promise<UserCategoryRow> {
    const existing = await this.repos.admin.listCategories(actor.tenantId);
    if (existing.some((c) => c.code === input.code)) {
      throw new DomainError('CONFLICT', `User category "${input.code}" already exists.`, 409);
    }
    const row = await this.repos.admin.createCategory(actor.tenantId, {
      code: input.code,
      name: input.name,
      isActive: input.isActive ?? true,
    });
    await this.audit(actor, 'USER_CATEGORY_CREATED', 'UserCategory', row.id, { code: row.code });
    return row;
  }

  async updateCategory(
    actor: OpsActor,
    id: string,
    patch: Partial<UserCategoryInput>,
  ): Promise<UserCategoryRow> {
    if (patch.code) {
      const existing = await this.repos.admin.listCategories(actor.tenantId);
      if (existing.some((c) => c.code === patch.code && c.id !== id)) {
        throw new DomainError('CONFLICT', `User category "${patch.code}" already exists.`, 409);
      }
    }
    const row = await this.repos.admin.updateCategory(actor.tenantId, id, patch);
    if (!row) throw new DomainError('NOT_FOUND', 'User category not found.', 404);
    await this.audit(actor, 'USER_CATEGORY_UPDATED', 'UserCategory', id, {
      fields: Object.keys(patch),
    });
    return row;
  }

  async deleteCategory(actor: OpsActor, id: string): Promise<void> {
    const result = await this.repos.admin.deleteCategory(actor.tenantId, id);
    if (result === 'not_found') throw new DomainError('NOT_FOUND', 'User category not found.', 404);
    if (result === 'in_use') {
      throw new DomainError(
        'CONFLICT',
        'Users still have this category. Disable it instead of deleting it.',
        409,
      );
    }
    await this.audit(actor, 'USER_CATEGORY_DELETED', 'UserCategory', id, {});
  }

  // ── Update User Location ────────────────────────────────────────────────────────────────────────────────────────
  async updateUserLocation(actor: OpsActor, userId: string, storeId: string): Promise<void> {
    const user = await this.repos.admin.getUser(actor.tenantId, userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const store = (await this.repos.stores.listByTenant(actor.tenantId)).find(
      (s) => s.id === storeId,
    );
    if (!store || !store.isActive) {
      throw new DomainError('VALIDATION_ERROR', 'Choose an active location.', 422);
    }
    await this.repos.admin.setUserStore(actor.tenantId, userId, storeId);
    await this.audit(actor, 'USER_LOCATION_UPDATED', 'User', userId, {
      from: user.storeId,
      to: storeId,
    });
  }

  // ── Attribute Locking ───────────────────────────────────────────────────────────────────────────────────────────
  async getLocks(tenantId: string): Promise<{
    attributes: readonly { key: string; entity: string; label: string }[];
    locked: string[];
  }> {
    return {
      attributes: LOCKABLE_ATTRIBUTES,
      locked: [...(await getLockedAttributes(this.repos, tenantId))].sort(),
    };
  }

  async setLocks(actor: OpsActor, locks: string[]): Promise<string[]> {
    const unknown = locks.filter((k) => !isLockableAttribute(k));
    if (unknown.length > 0) {
      throw new DomainError('VALIDATION_ERROR', `Unknown attribute: ${unknown.join(', ')}.`, 422);
    }
    const unique = [...new Set(locks)].sort();
    await this.repos.admin.setSetting(
      actor.tenantId,
      LOCKS_SETTING_KEY,
      { locks: unique },
      actor.id,
    );
    await this.audit(actor, 'ATTRIBUTE_LOCKS_CHANGED', 'Setting', LOCKS_SETTING_KEY, {
      locked: unique,
    });
    return unique;
  }

  // ── Close Period ────────────────────────────────────────────────────────────────────────────────────────────────
  async getPeriod(tenantId: string): Promise<{ closedThrough: string | null; today: string }> {
    const tz = await getTenantTimeZone(this.repos, tenantId);
    return {
      closedThrough: await getClosedThrough(this.repos, tenantId),
      today: localDateString(new Date(), tz),
    };
  }

  async closePeriod(actor: OpsActor, closedThrough: string): Promise<{ closedThrough: string }> {
    const { today, closedThrough: current } = await this.getPeriod(actor.tenantId);
    if (Number.isNaN(Date.parse(`${closedThrough}T00:00:00Z`))) {
      throw new DomainError('VALIDATION_ERROR', 'Enter a real date.', 422);
    }
    if (closedThrough > today) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A period that has not ended cannot be closed.',
        422,
      );
    }
    if (current && closedThrough <= current) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `The period is already closed through ${current}. To go back, re-open it first.`,
        422,
      );
    }
    await this.repos.admin.setSetting(
      actor.tenantId,
      PERIOD_SETTING_KEY,
      { closedThrough },
      actor.id,
    );
    await this.audit(actor, 'PERIOD_CLOSED', 'Setting', PERIOD_SETTING_KEY, {
      closedThrough,
      previous: current,
    });
    return { closedThrough };
  }

  async reopenPeriod(actor: OpsActor): Promise<void> {
    const current = await getClosedThrough(this.repos, actor.tenantId);
    if (!current) throw new DomainError('NOT_FOUND', 'No period is closed.', 404);
    await this.repos.admin.removeSetting(actor.tenantId, PERIOD_SETTING_KEY);
    await this.audit(actor, 'PERIOD_REOPENED', 'Setting', PERIOD_SETTING_KEY, { was: current });
  }

  // ── Logs ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async auditLog(tenantId: string, q: LogQuery): Promise<AuditRow[]> {
    return this.repos.admin.listAudit(tenantId, q, await getTenantTimeZone(this.repos, tenantId));
  }
  async smsLog(tenantId: string, q: LogQuery): Promise<SmsLogRow[]> {
    return this.repos.admin.listSms(tenantId, q, await getTenantTimeZone(this.repos, tenantId));
  }
  async bankLog(tenantId: string, q: LogQuery): Promise<BankLogRow[]> {
    return this.repos.admin.listBank(tenantId, q, await getTenantTimeZone(this.repos, tenantId));
  }

  // ── Overhead ────────────────────────────────────────────────────────────────────────────────────────────────────
  listOverheadRuns(tenantId: string): Promise<OverheadRunRow[]> {
    return this.repos.admin.listOverheadRuns(tenantId);
  }

  /**
   * Overhead rate for a period = business expenses / net sales revenue x 100, from the same Profit & Loss figures the
   * Reports use. The result is stored as a run so past rates can be reviewed.
   */
  async generateOverhead(actor: OpsActor, input: GenerateOverheadInput): Promise<OverheadRunRow> {
    const tz = await getTenantTimeZone(this.repos, actor.tenantId);
    const { start, end } = localDayRange(input.from, input.to, tz);
    const pl = await this.repos.reports.profitLoss(actor.tenantId, { start, end, timeZone: tz });
    const revenue = pl.revenue;
    if (!/[1-9]/.test(revenue.replace('.', '')) || revenue.startsWith('-')) {
      throw new DomainError(
        'NO_SALES_IN_PERIOD',
        'There are no sales in this period, so an overhead rate cannot be calculated.',
        422,
      );
    }
    const run = await this.repos.admin.createOverheadRun(actor.tenantId, {
      periodFrom: input.from,
      periodTo: input.to,
      totalExpenses: pl.expenses,
      totalSales: revenue,
      ratePercent: percentOf(pl.expenses, revenue),
      notes: input.notes,
      createdById: actor.id,
    });
    await this.audit(actor, 'OVERHEAD_GENERATED', 'OverheadRun', run.id, {
      from: input.from,
      to: input.to,
      ratePercent: run.ratePercent,
    });
    return run;
  }

  async deleteOverheadRun(actor: OpsActor, id: string): Promise<void> {
    if (!(await this.repos.admin.deleteOverheadRun(actor.tenantId, id))) {
      throw new DomainError('NOT_FOUND', 'Overhead run not found.', 404);
    }
    await this.audit(actor, 'OVERHEAD_DELETED', 'OverheadRun', id, {});
  }

  // ── Locations Status ────────────────────────────────────────────────────────────────────────────────────────────
  listLocations(tenantId: string): Promise<StoreStatusRow[]> {
    return this.repos.admin.listStoreStatus(tenantId);
  }

  async setLocationActive(actor: OpsActor, storeId: string, isActive: boolean): Promise<void> {
    const stores = await this.repos.admin.listStoreStatus(actor.tenantId);
    const store = stores.find((s) => s.id === storeId);
    if (!store) throw new DomainError('NOT_FOUND', 'Location not found.', 404);
    if (!isActive) {
      if (store.isDefault) {
        throw new DomainError('CONFLICT', 'The default location cannot be deactivated.', 409);
      }
      if (stores.filter((s) => s.isActive && s.id !== storeId).length === 0) {
        throw new DomainError('CONFLICT', 'At least one location must stay active.', 409);
      }
    }
    await this.repos.admin.setStoreActive(actor.tenantId, storeId, isActive);
    await this.audit(actor, 'LOCATION_STATUS_CHANGED', 'Store', storeId, { isActive });
  }
}
