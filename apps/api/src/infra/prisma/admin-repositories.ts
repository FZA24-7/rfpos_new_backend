// Prisma adapter for the Administrator module (Security File rights, user categories, settings, logs, overhead, branches).
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@mafk/database';
import { localDayRange, type Right, type SystemRole } from '@mafk/shared';
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
} from '../../domain/admin.js';
import { ProvisioningConflictError } from '../../domain/types.js';

type Tx = Prisma.TransactionClient;

const isUnique = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

const emptyProfile = (): UserProfileData => ({
  fbrPosId: null,
  macAddress: null,
  userCategoryId: null,
  counterPos: null,
  port: null,
  fbrToken: null,
  pcSerial: null,
});

const range = (q: LogQuery, timeZone: string): { gte?: Date; lt?: Date } => {
  const out: { gte?: Date; lt?: Date } = {};
  if (q.from || q.to) {
    const from = q.from ?? q.to!;
    const to = q.to ?? q.from!;
    const r = localDayRange(from <= to ? from : to, from <= to ? to : from, timeZone);
    out.gte = r.start;
    out.lt = r.end;
  }
  return out;
};

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Security File ──────────────────────────────────────────────────────────────────────────────────────────────
  private toRow(u: {
    id: string;
    loginId: string;
    displayName: string;
    status: string;
    storeId: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    role: { systemRole: string };
    store: { name: string } | null;
    profile: { category: { name: string } | null } | null;
  }): AdminUserRow {
    return {
      id: u.id,
      loginId: u.loginId,
      displayName: u.displayName,
      status: u.status as AdminUserRow['status'],
      systemRole: u.role.systemRole as SystemRole,
      storeId: u.storeId,
      storeName: u.store?.name ?? null,
      categoryName: u.profile?.category?.name ?? null,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }

  async listUsers(
    tenantId: string,
    q: { q?: string; includeDisabled: boolean },
  ): Promise<AdminUserRow[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.includeDisabled ? {} : { status: 'ACTIVE' as const }),
        ...(q.q
          ? {
              OR: [
                { loginId: { contains: q.q, mode: 'insensitive' as const } },
                { displayName: { contains: q.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: {
        role: { select: { systemRole: true } },
        store: { select: { name: true } },
        profile: { select: { category: { select: { name: true } } } },
      },
      orderBy: { loginId: 'asc' },
    });
    return rows.map((r) => this.toRow(r));
  }

  async getUser(tenantId: string, userId: string): Promise<AdminUserDetail | null> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      include: {
        role: {
          select: {
            systemRole: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
        store: { select: { name: true } },
        profile: { include: { category: { select: { name: true } } } },
        moduleAccess: true,
        itemRights: true,
      },
    });
    if (!u) return null;
    const items: Record<string, Right[]> = {};
    for (const r of u.itemRights) {
      const rights: Right[] = [];
      if (r.canAccess) rights.push('access');
      if (r.canAdd) rights.push('add');
      if (r.canEdit) rights.push('edit');
      if (r.canDelete) rights.push('delete');
      if (rights.length > 0) items[r.itemKey] = rights;
    }
    const p = u.profile;
    return {
      ...this.toRow(u),
      profile: p
        ? {
            fbrPosId: p.fbrPosId,
            macAddress: p.macAddress,
            userCategoryId: p.userCategoryId,
            counterPos: p.counterPos,
            port: p.port,
            fbrToken: p.fbrToken,
            pcSerial: p.pcSerial,
          }
        : emptyProfile(),
      modules: u.moduleAccess.map((m) => m.moduleKey).sort(),
      items,
      hasSavedRights: u.moduleAccess.length > 0 || u.itemRights.length > 0,
      rolePermissionKeys: u.role.permissions.map((rp) => rp.permission.key).sort(),
    };
  }

  private async setRolePermissions(tx: Tx, roleId: string, keys: string[]): Promise<void> {
    const rows = await tx.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const found = new Set(rows.map((r) => r.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length > 0) {
      throw new Error(`Permission catalog is missing: ${missing.join(', ')}. Run db:seed first.`);
    }
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: rows.map((r) => ({ roleId, permissionId: r.id })) });
  }

  private async replaceRights(
    tx: Tx,
    tenantId: string,
    userId: string,
    selection: CreateAdminUserRecord['selection'],
  ): Promise<void> {
    await tx.userModuleAccess.deleteMany({ where: { userId } });
    await tx.userItemRight.deleteMany({ where: { userId } });
    await tx.userModuleAccess.createMany({
      data: selection.modules.map((moduleKey) => ({ userId, tenantId, moduleKey })),
    });
    const rows = Object.entries(selection.items)
      .filter(([, rights]) => rights.length > 0)
      .map(([itemKey, rights]) => ({
        userId,
        tenantId,
        itemKey,
        canAccess: rights.includes('access'),
        canAdd: rights.includes('add'),
        canEdit: rights.includes('edit'),
        canDelete: rights.includes('delete'),
      }));
    await tx.userItemRight.createMany({ data: rows });
  }

  async createUser(tenantId: string, input: CreateAdminUserRecord): Promise<{ id: string }> {
    const id = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            tenantId,
            key: `user-${id}`,
            name: `User ${input.loginId}`,
            systemRole: 'CUSTOM',
            isSystem: false,
          },
        });
        await this.setRolePermissions(tx, role.id, input.permissionKeys);
        await tx.user.create({
          data: {
            id,
            tenantId,
            storeId: input.storeId,
            roleId: role.id,
            loginId: input.loginId,
            displayName: input.displayName,
            passwordHash: input.passwordHash,
            status: 'ACTIVE',
            createdById: input.createdById,
          },
        });
        await tx.userProfile.create({ data: { userId: id, tenantId, ...input.profile } });
        await this.replaceRights(tx, tenantId, id, input.selection);
      });
    } catch (err) {
      if (isUnique(err)) {
        throw new ProvisioningConflictError(
          'loginId',
          `Login ID "${input.loginId}" is already in use.`,
        );
      }
      throw err;
    }
    return { id };
  }

  async updateUser(tenantId: string, userId: string, input: UpdateAdminUserRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId, deletedAt: null },
        include: { role: { select: { id: true, key: true, systemRole: true } } },
      });
      if (!user) throw new Error('User not found.');
      const data: Prisma.UserUncheckedUpdateInput = {};
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.passwordHash !== undefined) {
        data.passwordHash = input.passwordHash;
        data.passwordChangedAt = new Date();
      }
      if (input.storeId !== undefined) data.storeId = input.storeId;

      if (input.rights) {
        // Rights always live on the user's PRIVATE role; a shared role (Manager, Cashier ...) is never edited.
        const ownKey = `user-${userId}`;
        let roleId =
          (input.rights.ownerRole && user.role.systemRole === 'CLIENT_MASTER_ADMIN') ||
          (user.role.key === ownKey && user.role.systemRole === 'CUSTOM')
            ? user.role.id
            : null;
        if (!roleId) {
          const role = await tx.role.create({
            data: {
              tenantId,
              key: ownKey,
              name: `User ${user.loginId}`,
              systemRole: 'CUSTOM',
              isSystem: false,
            },
          });
          roleId = role.id;
          data.roleId = roleId;
        }
        await this.setRolePermissions(tx, roleId, input.rights.permissionKeys);
        await this.replaceRights(tx, tenantId, userId, input.rights.selection);
      }
      if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data });

      if (input.profile) {
        const patch = Object.fromEntries(
          Object.entries(input.profile).filter(([, v]) => v !== undefined),
        ) as Partial<UserProfileData>;
        await tx.userProfile.upsert({
          where: { userId },
          create: { userId, tenantId, ...patch },
          update: patch,
        });
      }
    });
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { status: 'DISABLED', deletedAt: new Date() },
    });
  }

  async setUserStore(tenantId: string, userId: string, storeId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { storeId },
    });
  }

  // ── User categories ─────────────────────────────────────────────────────────────────────────────────────────────
  private catRow(c: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    _count: { profiles: number };
  }): UserCategoryRow {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      isActive: c.isActive,
      userCount: c._count.profiles,
    };
  }

  async listCategories(tenantId: string): Promise<UserCategoryRow[]> {
    const rows = await this.prisma.userCategory.findMany({
      where: { tenantId },
      include: { _count: { select: { profiles: true } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.catRow(r));
  }

  async createCategory(
    tenantId: string,
    input: { code: string; name: string; isActive: boolean },
  ): Promise<UserCategoryRow> {
    const row = await this.prisma.userCategory.create({
      data: { tenantId, ...input },
      include: { _count: { select: { profiles: true } } },
    });
    return this.catRow(row);
  }

  async updateCategory(
    tenantId: string,
    id: string,
    patch: { code?: string; name?: string; isActive?: boolean },
  ): Promise<UserCategoryRow | null> {
    const res = await this.prisma.userCategory.updateMany({ where: { id, tenantId }, data: patch });
    if (res.count === 0) return null;
    const row = await this.prisma.userCategory.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { profiles: true } } },
    });
    return row ? this.catRow(row) : null;
  }

  async deleteCategory(tenantId: string, id: string): Promise<'deleted' | 'in_use' | 'not_found'> {
    const row = await this.prisma.userCategory.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { profiles: true } } },
    });
    if (!row) return 'not_found';
    if (row._count.profiles > 0) return 'in_use';
    await this.prisma.userCategory.delete({ where: { id } });
    return 'deleted';
  }

  // ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────────
  async getSetting(tenantId: string, key: string): Promise<unknown> {
    const row = await this.prisma.setting.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    return row?.value ?? null;
  }

  async setSetting(tenantId: string, key: string, value: unknown, userId: string): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: json, updatedById: userId },
      update: { value: json, updatedById: userId },
    });
  }

  async removeSetting(tenantId: string, key: string): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { tenantId, key } });
  }

  // ── Logs ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async listAudit(tenantId: string, q: LogQuery, timeZone: string): Promise<AuditRow[]> {
    const createdAt = range(q, timeZone);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(createdAt.gte ? { createdAt } : {}),
        ...(q.q
          ? {
              OR: [
                { action: { contains: q.q, mode: 'insensitive' } },
                { entity: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, loginId: true },
        })
      : [];
    const loginById = new Map(users.map((u) => [u.id, u.loginId]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      userId: r.userId,
      userLoginId: r.userId ? (loginById.get(r.userId) ?? null) : null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    }));
  }

  async listSms(tenantId: string, q: LogQuery, timeZone: string): Promise<SmsLogRow[]> {
    const createdAt = range(q, timeZone);
    const rows = await this.prisma.smsLog.findMany({
      where: {
        tenantId,
        ...(createdAt.gte ? { createdAt } : {}),
        ...(q.q
          ? {
              OR: [
                { recipient: { contains: q.q } },
                { message: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      recipient: r.recipient,
      message: r.message,
      status: r.status,
      error: r.error,
    }));
  }

  async recordSms(
    tenantId: string,
    input: { recipient: string; message: string; status: string; error?: string; userId?: string },
  ): Promise<void> {
    await this.prisma.smsLog.create({
      data: {
        tenantId,
        recipient: input.recipient,
        message: input.message,
        status: input.status,
        error: input.error ?? null,
        createdById: input.userId ?? null,
      },
    });
  }

  async listBank(tenantId: string, q: LogQuery, timeZone: string): Promise<BankLogRow[]> {
    const r = range(q, timeZone);
    const methods = ['CARD', 'BANK_TRANSFER'] as const;
    const [payments, expenses] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, method: { in: [...methods] }, ...(r.gte ? { createdAt: r } : {}) },
        include: { sale: { select: { invoiceNo: true } } },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      this.prisma.expense.findMany({
        where: { tenantId, method: { in: [...methods] }, ...(r.gte ? { expenseDate: r } : {}) },
        orderBy: { expenseDate: 'desc' },
        take: q.limit,
      }),
    ]);
    const rows: BankLogRow[] = [
      ...payments.map((p) => ({
        at: p.createdAt,
        source: 'SALE_PAYMENT' as const,
        method: p.method as 'CARD' | 'BANK_TRANSFER',
        amount: p.amount.toFixed(2),
        reference: p.reference,
        documentRef: p.sale.invoiceNo,
      })),
      ...expenses.map((e) => ({
        at: e.expenseDate,
        source: 'EXPENSE' as const,
        method: e.method as 'CARD' | 'BANK_TRANSFER',
        amount: e.amount.toFixed(2),
        reference: null,
        documentRef: e.category,
      })),
    ];
    const needle = q.q?.toLowerCase();
    return rows
      .filter(
        (x) =>
          !needle ||
          `${x.reference ?? ''} ${x.documentRef ?? ''} ${x.method}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, q.limit);
  }

  // ── Overhead ────────────────────────────────────────────────────────────────────────────────────────────────────
  private runRow(r: {
    id: string;
    periodFrom: Date;
    periodTo: Date;
    totalExpenses: { toFixed(n: number): string };
    totalSales: { toFixed(n: number): string };
    ratePercent: { toFixed(n: number): string };
    notes: string | null;
    createdAt: Date;
    createdById: string;
  }): OverheadRunRow {
    return {
      id: r.id,
      periodFrom: ymdOf(r.periodFrom),
      periodTo: ymdOf(r.periodTo),
      totalExpenses: r.totalExpenses.toFixed(2),
      totalSales: r.totalSales.toFixed(2),
      ratePercent: r.ratePercent.toFixed(4),
      notes: r.notes,
      createdAt: r.createdAt,
      createdById: r.createdById,
    };
  }

  async createOverheadRun(
    tenantId: string,
    input: Parameters<AdminRepository['createOverheadRun']>[1],
  ): Promise<OverheadRunRow> {
    const row = await this.prisma.overheadRun.create({
      data: {
        tenantId,
        periodFrom: new Date(`${input.periodFrom}T00:00:00Z`),
        periodTo: new Date(`${input.periodTo}T00:00:00Z`),
        totalExpenses: input.totalExpenses,
        totalSales: input.totalSales,
        ratePercent: input.ratePercent,
        notes: input.notes ?? null,
        createdById: input.createdById,
      },
    });
    return this.runRow(row);
  }

  async listOverheadRuns(tenantId: string): Promise<OverheadRunRow[]> {
    const rows = await this.prisma.overheadRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.runRow(r));
  }

  async deleteOverheadRun(tenantId: string, id: string): Promise<boolean> {
    const res = await this.prisma.overheadRun.deleteMany({ where: { id, tenantId } });
    return res.count > 0;
  }

  // ── Locations ───────────────────────────────────────────────────────────────────────────────────────────────────
  async listStoreStatus(tenantId: string): Promise<StoreStatusRow[]> {
    const rows = await this.prisma.store.findMany({
      where: { tenantId },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      isDefault: s.isDefault,
      isActive: s.isActive,
      userCount: s._count.users,
    }));
  }

  async setStoreActive(tenantId: string, storeId: string, isActive: boolean): Promise<boolean> {
    const res = await this.prisma.store.updateMany({
      where: { id: storeId, tenantId },
      data: { isActive },
    });
    return res.count > 0;
  }
}
