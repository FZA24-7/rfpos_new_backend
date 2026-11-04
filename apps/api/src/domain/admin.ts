// Administrator module domain types and the single persistence port it needs.
import type { Right, RightsSelection } from '@mafk/shared';
import type { SystemRole } from '@mafk/shared';
import type { LogQuery } from '@mafk/validation';

export interface UserProfileData {
  fbrPosId: string | null;
  macAddress: string | null;
  userCategoryId: string | null;
  counterPos: string | null;
  port: number | null;
  fbrToken: string | null;
  pcSerial: string | null;
}

export interface AdminUserRow {
  id: string;
  loginId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  systemRole: SystemRole;
  storeId: string | null;
  storeName: string | null;
  categoryName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminUserDetail extends AdminUserRow {
  profile: UserProfileData;
  /** Saved Level 1 selection (only meaningful when the user has saved rights). */
  modules: string[];
  /** Saved Level 2/3 selection. */
  items: Record<string, Right[]>;
  hasSavedRights: boolean;
  /** Permission keys of the user's current role (what the API actually enforces). */
  rolePermissionKeys: string[];
}

export interface CreateAdminUserRecord {
  loginId: string;
  displayName: string;
  passwordHash: string;
  storeId: string | null;
  profile: UserProfileData;
  selection: RightsSelection;
  permissionKeys: string[];
  createdById: string;
}

export interface UpdateAdminUserRecord {
  displayName?: string;
  passwordHash?: string;
  storeId?: string | null;
  /** Only the fields that were sent. */
  profile?: Partial<UserProfileData>;
  rights?: { selection: RightsSelection; permissionKeys: string[] };
}

export interface UserCategoryRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  userId: string | null;
  userLoginId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SmsLogRow {
  id: string;
  createdAt: Date;
  recipient: string;
  message: string;
  status: string;
  error: string | null;
}

export interface BankLogRow {
  at: Date;
  source: 'SALE_PAYMENT' | 'EXPENSE';
  method: 'CARD' | 'BANK_TRANSFER';
  amount: string;
  reference: string | null;
  documentRef: string | null;
}

export interface OverheadRunRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  totalExpenses: string;
  totalSales: string;
  ratePercent: string;
  notes: string | null;
  createdAt: Date;
  createdById: string;
}

export interface StoreStatusRow {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  userCount: number;
}

export interface AdminRepository {
  // Security File
  listUsers(tenantId: string, q: { q?: string; includeDisabled: boolean }): Promise<AdminUserRow[]>;
  getUser(tenantId: string, userId: string): Promise<AdminUserDetail | null>;
  /** Throws ProvisioningConflictError('loginId') when the Login ID is taken. */
  createUser(tenantId: string, input: CreateAdminUserRecord): Promise<{ id: string }>;
  updateUser(tenantId: string, userId: string, input: UpdateAdminUserRecord): Promise<void>;
  /** Soft delete: disables the account and hides it; business records keep pointing at the user id. */
  deleteUser(tenantId: string, userId: string): Promise<void>;
  setUserStore(tenantId: string, userId: string, storeId: string): Promise<void>;
  // User categories
  listCategories(tenantId: string): Promise<UserCategoryRow[]>;
  createCategory(
    tenantId: string,
    input: { code: string; name: string; isActive: boolean },
  ): Promise<UserCategoryRow>;
  updateCategory(
    tenantId: string,
    id: string,
    patch: { code?: string; name?: string; isActive?: boolean },
  ): Promise<UserCategoryRow | null>;
  /** 'in_use' when users still have this category (deactivate it instead). */
  deleteCategory(tenantId: string, id: string): Promise<'deleted' | 'in_use' | 'not_found'>;
  // Tenant settings (attribute locks, closed period)
  getSetting(tenantId: string, key: string): Promise<unknown>;
  setSetting(tenantId: string, key: string, value: unknown, userId: string): Promise<void>;
  removeSetting(tenantId: string, key: string): Promise<void>;
  // Logs
  listAudit(tenantId: string, q: LogQuery, timeZone: string): Promise<AuditRow[]>;
  listSms(tenantId: string, q: LogQuery, timeZone: string): Promise<SmsLogRow[]>;
  recordSms(
    tenantId: string,
    input: { recipient: string; message: string; status: string; error?: string; userId?: string },
  ): Promise<void>;
  listBank(tenantId: string, q: LogQuery, timeZone: string): Promise<BankLogRow[]>;
  // Overhead
  createOverheadRun(
    tenantId: string,
    input: {
      periodFrom: string;
      periodTo: string;
      totalExpenses: string;
      totalSales: string;
      ratePercent: string;
      notes?: string;
      createdById: string;
    },
  ): Promise<OverheadRunRow>;
  listOverheadRuns(tenantId: string): Promise<OverheadRunRow[]>;
  deleteOverheadRun(tenantId: string, id: string): Promise<boolean>;
  // Locations
  listStoreStatus(tenantId: string): Promise<StoreStatusRow[]>;
  setStoreActive(tenantId: string, storeId: string, isActive: boolean): Promise<boolean>;
}
