// In-memory double of the Administrator persistence port. Test-only; production uses PrismaAdminRepository.
import { randomUUID } from 'node:crypto';
import { localDayRange, type Right, type RightsSelection } from '@mafk/shared';
import type { LogQuery } from '@mafk/validation';
import type {
  AdminRepository,
  AdminUserDetail,
  AdminUserRow,
  AuditRow,
  BankLogRow,
  CreateAdminUserRecord,
  OverheadRunRow,
  SmsLogRow,
  StoreStatusRow,
  UpdateAdminUserRecord,
  UserCategoryRow,
  UserProfileData,
} from '../../src/domain/admin.js';
import { ProvisioningConflictError } from '../../src/domain/types.js';
import type {
  FakeAuditLogRepository,
  FakeRoleRepository,
  FakeStoreRepository,
  FakeUserRepository,
} from './in-memory-repositories.js';
import type { FakeExpenseRepository } from './fake-phase6-repositories.js';
import type { FakeSaleRepository } from './fake-sale-repository.js';

const emptyProfile = (): UserProfileData => ({
  fbrPosId: null,
  macAddress: null,
  userCategoryId: null,
  counterPos: null,
  port: null,
  fbrToken: null,
  pcSerial: null,
});

interface UserExtra {
  displayName: string;
  createdById?: string;
  deleted: boolean;
  profile: UserProfileData;
  selection: RightsSelection | null;
}

export class FakeAdminRepository implements AdminRepository {
  private readonly extra = new Map<string, UserExtra>();
  private readonly categories = new Map<string, UserCategoryRow & { tenantId: string }>();
  private readonly settings = new Map<string, unknown>();
  private readonly sms: (SmsLogRow & { tenantId: string })[] = [];
  private readonly runs: (OverheadRunRow & { tenantId: string })[] = [];

  constructor(
    private readonly users: FakeUserRepository,
    private readonly roles: FakeRoleRepository,
    private readonly stores: FakeStoreRepository,
    private readonly audit: FakeAuditLogRepository,
    private readonly sales: FakeSaleRepository,
    private readonly expenses: FakeExpenseRepository,
  ) {}

  private ex(userId: string): UserExtra {
    let e = this.extra.get(userId);
    if (!e) {
      e = { displayName: '', deleted: false, profile: emptyProfile(), selection: null };
      this.extra.set(userId, e);
    }
    return e;
  }

  private rows(tenantId: string): AdminUserRow[] {
    return [...this.users.users.values()]
      .filter((u) => u.tenantId === tenantId && !this.extra.get(u.id)?.deleted)
      .map((u) => {
        const store = u.storeId ? this.stores.stores.get(u.storeId) : undefined;
        const cat = this.ex(u.id).profile.userCategoryId;
        return {
          id: u.id,
          loginId: u.loginId,
          displayName: u.displayName,
          status: u.status,
          systemRole: u.systemRole,
          storeId: u.storeId,
          storeName: store?.name ?? null,
          categoryName: cat ? (this.categories.get(cat)?.name ?? null) : null,
          lastLoginAt: null,
          createdAt: new Date(0),
        };
      });
  }

  async listUsers(tenantId: string, q: { q?: string; includeDisabled: boolean }) {
    const needle = q.q?.toLowerCase();
    return this.rows(tenantId)
      .filter((r) => q.includeDisabled || r.status === 'ACTIVE')
      .filter((r) => !needle || `${r.loginId} ${r.displayName}`.toLowerCase().includes(needle))
      .sort((a, b) => a.loginId.localeCompare(b.loginId));
  }

  async getUser(tenantId: string, userId: string): Promise<AdminUserDetail | null> {
    const row = this.rows(tenantId).find((r) => r.id === userId);
    if (!row) return null;
    const user = this.users.users.get(userId)!;
    const e = this.ex(userId);
    const role = this.roles.roles.get(user.roleId);
    return {
      ...row,
      profile: { ...e.profile },
      modules: e.selection ? [...e.selection.modules].sort() : [],
      items: e.selection
        ? (Object.fromEntries(
            Object.entries(e.selection.items).filter(([, r]) => r.length > 0),
          ) as Record<string, Right[]>)
        : {},
      hasSavedRights: e.selection !== null,
      rolePermissionKeys: [...(role?.permissionKeys ?? [])].sort(),
    };
  }

  async createUser(tenantId: string, input: CreateAdminUserRecord): Promise<{ id: string }> {
    if ([...this.users.users.values()].some((u) => u.loginId === input.loginId)) {
      throw new ProvisioningConflictError(
        'loginId',
        `Login ID "${input.loginId}" is already in use.`,
      );
    }
    const id = randomUUID();
    const role = this.roles.seed({
      id: `role-user-${id}`,
      tenantId,
      systemRole: 'CUSTOM',
      permissionKeys: input.permissionKeys,
    });
    this.users.seed({
      id,
      tenantId,
      storeId: input.storeId,
      roleId: role.id,
      systemRole: 'CUSTOM',
      loginId: input.loginId,
      displayName: input.displayName,
      status: 'ACTIVE',
      passwordHash: input.passwordHash,
    });
    this.extra.set(id, {
      displayName: input.displayName,
      createdById: input.createdById,
      deleted: false,
      profile: { ...input.profile },
      selection: input.selection,
    });
    return { id };
  }

  async updateUser(tenantId: string, userId: string, input: UpdateAdminUserRecord): Promise<void> {
    const user = this.users.users.get(userId);
    if (!user || user.tenantId !== tenantId) throw new Error('User not found.');
    const next = { ...user };
    if (input.displayName !== undefined) next.displayName = input.displayName;
    if (input.passwordHash !== undefined) next.passwordHash = input.passwordHash;
    if (input.storeId !== undefined) next.storeId = input.storeId;
    const e = this.ex(userId);
    if (input.profile) {
      for (const [k, v] of Object.entries(input.profile)) {
        if (v !== undefined) (e.profile as unknown as Record<string, unknown>)[k] = v;
      }
    }
    if (input.rights) {
      const ownRole = this.roles.roles.get(user.roleId);
      if (
        ownRole &&
        (user.roleId === `role-user-${userId}` ||
          (input.rights.ownerRole && ownRole.systemRole === 'CLIENT_MASTER_ADMIN'))
      ) {
        this.roles.seed({ ...ownRole, permissionKeys: input.rights.permissionKeys });
      } else {
        // never edit a shared role: move the user to a private one
        const role = this.roles.seed({
          id: `role-user-${userId}`,
          tenantId,
          systemRole: 'CUSTOM',
          permissionKeys: input.rights.permissionKeys,
        });
        next.roleId = role.id;
        next.systemRole = 'CUSTOM';
      }
      e.selection = input.rights.selection;
    }
    this.users.seed(next);
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    const u = this.users.users.get(userId);
    if (!u || u.tenantId !== tenantId) return;
    this.users.seed({ ...u, status: 'DISABLED' });
    this.ex(userId).deleted = true;
  }

  async setUserStore(tenantId: string, userId: string, storeId: string): Promise<void> {
    const u = this.users.users.get(userId);
    if (u && u.tenantId === tenantId) this.users.seed({ ...u, storeId });
  }

  private catView(c: UserCategoryRow & { tenantId: string }): UserCategoryRow {
    const userCount = [...this.extra.values()].filter(
      (e) => !e.deleted && e.profile.userCategoryId === c.id,
    ).length;
    return { id: c.id, code: c.code, name: c.name, isActive: c.isActive, userCount };
  }
  async listCategories(tenantId: string) {
    return [...this.categories.values()]
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => this.catView(c));
  }
  async createCategory(tenantId: string, input: { code: string; name: string; isActive: boolean }) {
    if (
      [...this.categories.values()].some((c) => c.tenantId === tenantId && c.code === input.code)
    ) {
      throw new Error('duplicate code');
    }
    const row = { id: randomUUID(), tenantId, userCount: 0, ...input };
    this.categories.set(row.id, row);
    return this.catView(row);
  }
  async updateCategory(
    tenantId: string,
    id: string,
    patch: { code?: string; name?: string; isActive?: boolean },
  ) {
    const c = this.categories.get(id);
    if (!c || c.tenantId !== tenantId) return null;
    const next = {
      ...c,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    this.categories.set(id, next);
    return this.catView(next);
  }
  async deleteCategory(tenantId: string, id: string) {
    const c = this.categories.get(id);
    if (!c || c.tenantId !== tenantId) return 'not_found' as const;
    if (this.catView(c).userCount > 0) return 'in_use' as const;
    this.categories.delete(id);
    return 'deleted' as const;
  }

  async getSetting(tenantId: string, key: string) {
    return this.settings.get(`${tenantId}:${key}`) ?? null;
  }
  async setSetting(tenantId: string, key: string, value: unknown) {
    this.settings.set(`${tenantId}:${key}`, value);
  }
  async removeSetting(tenantId: string, key: string) {
    this.settings.delete(`${tenantId}:${key}`);
  }

  private inRange(d: Date, q: LogQuery, tz: string): boolean {
    if (!q.from && !q.to) return true;
    const from = q.from ?? q.to!;
    const to = q.to ?? q.from!;
    const r = localDayRange(from <= to ? from : to, from <= to ? to : from, tz);
    return d >= r.start && d < r.end;
  }

  async listAudit(tenantId: string, q: LogQuery, tz: string): Promise<AuditRow[]> {
    const needle = q.q?.toLowerCase();
    return this.audit.entries
      .filter((e) => e.tenantId === tenantId && this.inRange(e.createdAt, q, tz))
      .filter((e) => !needle || `${e.action} ${e.entity}`.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, q.limit)
      .map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        userId: e.userId,
        userLoginId: e.userId ? (this.users.users.get(e.userId)?.loginId ?? null) : null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        ipAddress: e.ipAddress ?? null,
        metadata: e.metadata ?? null,
      }));
  }

  async listSms(tenantId: string, q: LogQuery, tz: string): Promise<SmsLogRow[]> {
    return this.sms
      .filter((s) => s.tenantId === tenantId && this.inRange(s.createdAt, q, tz))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, q.limit)
      .map(({ tenantId: _t, ...row }) => row);
  }
  async recordSms(
    tenantId: string,
    input: { recipient: string; message: string; status: string; error?: string },
  ) {
    this.sms.push({
      tenantId,
      id: randomUUID(),
      createdAt: new Date(),
      recipient: input.recipient,
      message: input.message,
      status: input.status,
      error: input.error ?? null,
    });
  }

  async listBank(tenantId: string, q: LogQuery, tz: string): Promise<BankLogRow[]> {
    const rows: BankLogRow[] = [];
    for (const sale of this.sales.sales.values()) {
      const s = sale as unknown as {
        tenantId: string;
        invoiceNo: string;
        soldAt: Date;
        payments: { method: string; amount: string; reference: string | null }[];
      };
      if (s.tenantId !== tenantId) continue;
      for (const p of s.payments) {
        if (p.method !== 'CARD' && p.method !== 'BANK_TRANSFER') continue;
        if (!this.inRange(s.soldAt, q, tz)) continue;
        rows.push({
          at: s.soldAt,
          source: 'SALE_PAYMENT',
          method: p.method,
          amount: p.amount,
          reference: p.reference,
          documentRef: s.invoiceNo,
        });
      }
    }
    for (const e of this.expenses.expenses.values()) {
      if (e.tenantId !== tenantId || (e.method !== 'CARD' && e.method !== 'BANK_TRANSFER'))
        continue;
      if (!this.inRange(e.expenseDate, q, tz)) continue;
      rows.push({
        at: e.expenseDate,
        source: 'EXPENSE',
        method: e.method,
        amount: e.amount,
        reference: null,
        documentRef: e.category,
      });
    }
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, q.limit);
  }

  async createOverheadRun(
    tenantId: string,
    input: Parameters<AdminRepository['createOverheadRun']>[1],
  ): Promise<OverheadRunRow> {
    const row = {
      tenantId,
      id: randomUUID(),
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      totalExpenses: input.totalExpenses,
      totalSales: input.totalSales,
      ratePercent: input.ratePercent,
      notes: input.notes ?? null,
      createdAt: new Date(),
      createdById: input.createdById,
    };
    this.runs.push(row);
    const { tenantId: _t, ...out } = row;
    return out;
  }
  async listOverheadRuns(tenantId: string) {
    return this.runs
      .filter((r) => r.tenantId === tenantId)
      .map(({ tenantId: _t, ...r }) => r)
      .reverse();
  }
  async deleteOverheadRun(tenantId: string, id: string) {
    const i = this.runs.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (i < 0) return false;
    this.runs.splice(i, 1);
    return true;
  }

  async listStoreStatus(tenantId: string): Promise<StoreStatusRow[]> {
    return [...this.stores.stores.values()]
      .filter((s) => s.tenantId === tenantId)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        isDefault: s.isDefault,
        isActive: s.isActive,
        userCount: this.rows(tenantId).filter((u) => u.storeId === s.id).length,
      }));
  }
  async setStoreActive(tenantId: string, storeId: string, isActive: boolean) {
    const s = this.stores.stores.get(storeId);
    if (!s || s.tenantId !== tenantId) return false;
    this.stores.seed({ ...s, isActive });
    return true;
  }
}
