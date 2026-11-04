import { apiRequest } from './client.js';

export type Right = 'access' | 'add' | 'edit' | 'delete';
export const RIGHT_LABELS: Record<Right, string> = {
  access: 'Access',
  add: 'Add Rights',
  edit: 'Edit Rights',
  delete: 'Delete Rights',
};

export interface RegistryItem {
  key: string;
  name: string;
  kind: 'form' | 'report';
  rights: Right[];
  uses: string[];
}
export interface RegistryModule {
  key: string;
  prefix: string;
  name: string;
  items: RegistryItem[];
}
export interface Registry {
  rights: Right[];
  baseline: string[];
  modules: RegistryModule[];
}

export interface RightsSelection {
  modules: string[];
  items: Record<string, Right[]>;
}

export interface UserRow {
  id: string;
  loginId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  systemRole: string;
  storeId: string | null;
  storeName: string | null;
  categoryName: string | null;
  lastLoginAt: string | null;
}
export interface UserProfile {
  fbrPosId: string | null;
  macAddress: string | null;
  userCategoryId: string | null;
  counterPos: string | null;
  port: number | null;
  pcSerial: string | null;
  fbrTokenSet: boolean;
  fbrTokenHint: string | null;
}
export interface UserDetail extends UserRow {
  profile: UserProfile;
  rights: RightsSelection;
  rightsSource: 'saved' | 'role';
  rightsEditable: boolean;
  effectivePermissions: string[];
}
export interface Lookups {
  categories: { id: string; code: string; name: string }[];
  locations: { id: string; code: string; name: string }[];
}

export interface SaveUserBody {
  loginId?: string;
  displayName: string;
  password?: string;
  fbrPosId: string | null;
  macAddress: string | null;
  userCategoryId: string | null;
  counterPos: string | null;
  port: number | null;
  /** undefined = keep, null = clear, string = replace */
  fbrToken?: string | null;
  pcSerial: string | null;
  storeId: string | null;
  rights?: RightsSelection;
}

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
}
export interface LocationRow {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  userCount: number;
}
export interface AuditRow {
  id: string;
  createdAt: string;
  userLoginId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
}
export interface SmsRow {
  id: string;
  createdAt: string;
  recipient: string;
  message: string;
  status: string;
  error: string | null;
}
export interface BankRow {
  at: string;
  source: 'SALE_PAYMENT' | 'EXPENSE';
  method: 'CARD' | 'BANK_TRANSFER';
  amount: string;
  reference: string | null;
  documentRef: string | null;
}
export interface OverheadRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  totalExpenses: string;
  totalSales: string;
  ratePercent: string;
  notes: string | null;
  createdAt: string;
}
export interface LocksState {
  attributes: { key: string; entity: string; label: string }[];
  locked: string[];
}
export interface PeriodState {
  closedThrough: string | null;
  today: string;
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const e = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return e.length ? `?${new URLSearchParams(e.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export interface LogFilter {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
}

export const adminApi = {
  registry: () => apiRequest<Registry>('/admin/registry'),
  lookups: () => apiRequest<Lookups>('/admin/security/lookups'),
  users: (q: { q?: string; includeDisabled?: boolean }) =>
    apiRequest<UserRow[]>(`/admin/users${qs({ q: q.q, includeDisabled: q.includeDisabled })}`),
  user: (id: string) => apiRequest<UserDetail>(`/admin/users/${id}`),
  createUser: (body: SaveUserBody) =>
    apiRequest<UserDetail>('/admin/users', { method: 'POST', body }),
  updateUser: (id: string, body: Partial<SaveUserBody> & { status?: 'ACTIVE' | 'DISABLED' }) =>
    apiRequest<UserDetail>(`/admin/users/${id}`, { method: 'PATCH', body }),
  deleteUser: (id: string) => apiRequest<void>(`/admin/users/${id}`, { method: 'DELETE' }),

  categories: () => apiRequest<CategoryRow[]>('/admin/user-categories'),
  createCategory: (body: { code: string; name: string }) =>
    apiRequest<CategoryRow>('/admin/user-categories', { method: 'POST', body }),
  updateCategory: (id: string, body: { code?: string; name?: string; isActive?: boolean }) =>
    apiRequest<CategoryRow>(`/admin/user-categories/${id}`, { method: 'PATCH', body }),
  deleteCategory: (id: string) =>
    apiRequest<void>(`/admin/user-categories/${id}`, { method: 'DELETE' }),

  setUserLocation: (userId: string, storeId: string) =>
    apiRequest<void>(`/admin/users/${userId}/location`, { method: 'PATCH', body: { storeId } }),

  locks: () => apiRequest<LocksState>('/admin/attribute-locks'),
  setLocks: (locks: string[]) =>
    apiRequest<LocksState>('/admin/attribute-locks', { method: 'PUT', body: { locks } }),

  period: () => apiRequest<PeriodState>('/admin/period'),
  closePeriod: (closedThrough: string) =>
    apiRequest<{ closedThrough: string }>('/admin/period', {
      method: 'POST',
      body: { closedThrough },
    }),
  reopenPeriod: () => apiRequest<void>('/admin/period', { method: 'DELETE' }),

  auditLog: (f: LogFilter) => apiRequest<AuditRow[]>(`/admin/logs/audit${qs({ ...f })}`),
  smsLog: (f: LogFilter) => apiRequest<SmsRow[]>(`/admin/logs/sms${qs({ ...f })}`),
  bankLog: (f: LogFilter) => apiRequest<BankRow[]>(`/admin/logs/bank${qs({ ...f })}`),

  overhead: () => apiRequest<OverheadRow[]>('/admin/overhead'),
  generateOverhead: (body: { from: string; to: string; notes?: string }) =>
    apiRequest<OverheadRow>('/admin/overhead', { method: 'POST', body }),
  deleteOverhead: (id: string) => apiRequest<void>(`/admin/overhead/${id}`, { method: 'DELETE' }),

  locations: () => apiRequest<LocationRow[]>('/admin/locations'),
  setLocationActive: (id: string, isActive: boolean) =>
    apiRequest<void>(`/admin/locations/${id}`, { method: 'PATCH', body: { isActive } }),
};
