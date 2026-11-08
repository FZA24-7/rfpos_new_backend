// Security File: users, their module / form / report rights, and enforcement of "only what was explicitly granted".
import { normalizeLoginId } from '@mafk/shared';
import {
  BASELINE_PERMISSIONS,
  derivePermissions,
  RightsValidationError,
  selectionFromPermissions,
  type RightsSelection,
} from '@mafk/shared';
import type { CreateAdminUserInput, UpdateAdminUserInput } from '@mafk/validation';
import type { AdminUserDetail, AdminUserRow, UserProfileData } from '../domain/admin.js';
import type { Repositories } from '../domain/ports.js';
import { DomainError, ProvisioningConflictError } from '../domain/types.js';
import type { PasswordHasher } from '../security/password.js';

export interface AdminActor {
  id: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
}

export interface AdminUserView {
  id: string;
  loginId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  systemRole: string;
  storeId: string | null;
  storeName: string | null;
  categoryName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  profile: Omit<UserProfileData, 'fbrToken'> & {
    fbrTokenSet: boolean;
    fbrTokenHint: string | null;
  };
  rights: RightsSelection;
  /** 'saved' = set in the Security File; 'role' = comes from a shared role and was never saved here. */
  rightsSource: 'saved' | 'role';
  rightsEditable: boolean;
  effectivePermissions: string[];
}

const hint = (token: string | null): string | null => (token ? `••••${token.slice(-4)}` : null);

export class AdminSecurityService {
  constructor(
    private readonly repos: Repositories,
    private readonly hasher: PasswordHasher,
  ) {}

  /** For the platform Master Admin, who names the business explicitly. */
  async assertTenantExists(tenantId: string): Promise<void> {
    if (!(await this.repos.tenants.findById(tenantId))) {
      throw new DomainError('NOT_FOUND', 'Client not found.', 404);
    }
  }

  listUsers(
    tenantId: string,
    q: { q?: string; includeDisabled: boolean },
  ): Promise<AdminUserRow[]> {
    return this.repos.admin.listUsers(tenantId, q);
  }

  private toView(actor: AdminActor, d: AdminUserDetail): AdminUserView {
    const { fbrToken, ...profile } = d.profile;
    const saved = d.hasSavedRights;
    const rights: RightsSelection = saved
      ? { modules: d.modules, items: d.items }
      : selectionFromPermissions(d.rolePermissionKeys);
    return {
      id: d.id,
      loginId: d.loginId,
      displayName: d.displayName,
      status: d.status,
      systemRole: d.systemRole,
      storeId: d.storeId,
      storeName: d.storeName,
      categoryName: d.categoryName,
      lastLoginAt: d.lastLoginAt,
      createdAt: d.createdAt,
      profile: { ...profile, fbrTokenSet: !!fbrToken, fbrTokenHint: hint(fbrToken) },
      rights,
      rightsSource: saved ? 'saved' : 'role',
      rightsEditable: d.systemRole !== 'CLIENT_MASTER_ADMIN' && d.id !== actor.id,
      effectivePermissions: d.rolePermissionKeys,
    };
  }

  async getUser(actor: AdminActor, userId: string): Promise<AdminUserView> {
    const d = await this.repos.admin.getUser(actor.tenantId, userId);
    if (!d) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    return this.toView(actor, d);
  }

  /** A grantor can never hand out a permission they do not hold themselves. */
  private assertNoEscalation(actor: AdminActor, keys: readonly string[]): void {
    const extra = keys.filter(
      (k) => !BASELINE_PERMISSIONS.includes(k) && !actor.permissions.has(k),
    );
    if (extra.length > 0) {
      throw new DomainError(
        'RIGHTS_ESCALATION',
        'You cannot grant rights that you do not have yourself.',
        403,
      );
    }
  }

  private permissionsFor(actor: AdminActor, selection: RightsSelection): string[] {
    let keys: string[];
    try {
      keys = derivePermissions(selection);
    } catch (err) {
      if (err instanceof RightsValidationError) {
        throw new DomainError('RIGHTS_INVALID', err.message, 422);
      }
      throw err;
    }
    this.assertNoEscalation(actor, keys);
    return keys;
  }

  private async validateRefs(
    tenantId: string,
    refs: { storeId?: string | null; userCategoryId?: string | null },
  ): Promise<void> {
    if (refs.storeId) {
      const stores = await this.repos.stores.listByTenant(tenantId);
      const store = stores.find((s) => s.id === refs.storeId);
      if (!store)
        throw new DomainError('VALIDATION_ERROR', 'Selected location does not exist.', 422);
      if (!store.isActive) {
        throw new DomainError('VALIDATION_ERROR', 'Selected location is not active.', 422);
      }
    }
    if (refs.userCategoryId) {
      const cats = await this.repos.admin.listCategories(tenantId);
      const cat = cats.find((c) => c.id === refs.userCategoryId);
      if (!cat)
        throw new DomainError('VALIDATION_ERROR', 'Selected user type does not exist.', 422);
    }
  }

  async createUser(actor: AdminActor, input: CreateAdminUserInput): Promise<AdminUserView> {
    const loginId = normalizeLoginId(input.loginId);
    if (await this.repos.users.existsByLoginId(loginId)) {
      throw new DomainError('LOGIN_ID_TAKEN', `Login ID "${loginId}" is already in use.`, 409);
    }

    const license = await this.repos.licenses.findActiveByTenant(actor.tenantId);
    if (license) {
      const users = await this.repos.users.listByTenant(actor.tenantId);
      const active = users.filter((u) => u.status === 'ACTIVE').length;
      if (active >= license.maxUsers) {
        throw new DomainError(
          'LICENSE_USER_LIMIT',
          `Your license allows ${license.maxUsers} users and all of them are in use.`,
          409,
        );
      }
    }

    const stores = await this.repos.stores.listByTenant(actor.tenantId);
    const storeId = input.storeId ?? stores.find((s) => s.isDefault && s.isActive)?.id ?? null;
    await this.validateRefs(actor.tenantId, { storeId, userCategoryId: input.userCategoryId });

    const selection: RightsSelection = input.rights;
    const permissionKeys = this.permissionsFor(actor, selection);
    const passwordHash = await this.hasher.hash(input.password);

    let id: string;
    try {
      ({ id } = await this.repos.admin.createUser(actor.tenantId, {
        loginId,
        displayName: input.displayName,
        passwordHash,
        storeId,
        profile: {
          fbrPosId: input.fbrPosId ?? null,
          macAddress: input.macAddress ?? null,
          userCategoryId: input.userCategoryId ?? null,
          counterPos: input.counterPos ?? null,
          port: input.port ?? null,
          fbrToken: input.fbrToken ?? null,
          pcSerial: input.pcSerial ?? null,
        },
        selection,
        permissionKeys,
        createdById: actor.id,
      }));
    } catch (err) {
      if (err instanceof ProvisioningConflictError) {
        throw new DomainError('LOGIN_ID_TAKEN', err.message, 409);
      }
      throw err;
    }

    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'ADMIN_USER_CREATED',
      entity: 'User',
      entityId: id,
      metadata: {
        loginId,
        modules: selection.modules.length,
        items: Object.keys(selection.items).length,
      },
    });
    return this.getUser(actor, id);
  }

  async updateUser(
    actor: AdminActor,
    userId: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserView> {
    const target = await this.repos.admin.getUser(actor.tenantId, userId);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const isSelf = target.id === actor.id;
    const isOwner = target.systemRole === 'CLIENT_MASTER_ADMIN';

    if (input.rights && (isSelf || isOwner)) {
      throw new DomainError(
        'PROTECTED_USER',
        isSelf
          ? 'You cannot change your own rights.'
          : 'The Client Master Admin always has full access and cannot be restricted.',
        403,
      );
    }
    if (input.status && (isSelf || isOwner)) {
      throw new DomainError('PROTECTED_USER', 'This account cannot be disabled here.', 403);
    }

    await this.validateRefs(actor.tenantId, {
      storeId: input.storeId,
      userCategoryId: input.userCategoryId,
    });

    const rights = input.rights
      ? {
          selection: input.rights as RightsSelection,
          permissionKeys: this.permissionsFor(actor, input.rights as RightsSelection),
        }
      : undefined;

    const profile: Partial<UserProfileData> = {};
    if (input.fbrPosId !== undefined) profile.fbrPosId = input.fbrPosId;
    if (input.macAddress !== undefined) profile.macAddress = input.macAddress;
    if (input.userCategoryId !== undefined) profile.userCategoryId = input.userCategoryId;
    if (input.counterPos !== undefined) profile.counterPos = input.counterPos;
    if (input.port !== undefined) profile.port = input.port;
    if (input.fbrToken !== undefined) profile.fbrToken = input.fbrToken;
    if (input.pcSerial !== undefined) profile.pcSerial = input.pcSerial;

    await this.repos.admin.updateUser(actor.tenantId, userId, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.password !== undefined
        ? { passwordHash: await this.hasher.hash(input.password) }
        : {}),
      ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
      ...(Object.keys(profile).length > 0 ? { profile } : {}),
      ...(rights ? { rights } : {}),
    });
    if (input.status && input.status !== target.status) {
      await this.repos.users.updateStatus(userId, input.status);
    }

    // Rights, password and disabling take effect for new tokens at once; ending the sessions makes the user sign in
    // again instead of keeping a refresh cookie that was issued under the old rights.
    if (rights || input.password !== undefined || input.status === 'DISABLED') {
      await this.repos.sessions.revokeAllForUser(userId, 'ADMIN_SECURITY_CHANGE');
    }

    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: rights ? 'ADMIN_USER_RIGHTS_CHANGED' : 'ADMIN_USER_UPDATED',
      entity: 'User',
      entityId: userId,
      metadata: {
        fields: Object.keys(input).filter((k) => k !== 'password' && k !== 'fbrToken'),
        passwordChanged: input.password !== undefined,
        ...(rights
          ? {
              modules: rights.selection.modules.length,
              items: Object.keys(rights.selection.items).length,
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    return this.getUser(actor, userId);
  }

  async deleteUser(actor: AdminActor, userId: string): Promise<void> {
    const target = await this.repos.admin.getUser(actor.tenantId, userId);
    if (!target) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    if (target.id === actor.id || target.systemRole === 'CLIENT_MASTER_ADMIN') {
      throw new DomainError('PROTECTED_USER', 'This account cannot be deleted.', 403);
    }
    await this.repos.admin.deleteUser(actor.tenantId, userId);
    await this.repos.sessions.revokeAllForUser(userId, 'USER_DELETED');
    await this.repos.auditLogs.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'ADMIN_USER_DELETED',
      entity: 'User',
      entityId: userId,
      metadata: { loginId: target.loginId },
    });
  }
}
