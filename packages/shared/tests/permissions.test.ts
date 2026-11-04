import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isGrantableToTenantRole,
  PERMISSION_CATALOG,
  TENANT_FORBIDDEN_PERMISSIONS,
} from '../src/permissions.js';

describe('PERMISSION_CATALOG', () => {
  it('has no duplicate keys', () => {
    expect(new Set(PERMISSION_CATALOG).size).toBe(PERMISSION_CATALOG.length);
  });

  it('includes the special, security-sensitive permissions from the spec', () => {
    for (const key of [
      'discount.apply',
      'sale.refund',
      'sale.void',
      'stock.adjust',
      'price.change',
      'users.manage',
      'licenses.manage',
    ]) {
      expect(PERMISSION_CATALOG).toContain(key);
    }
  });
});

describe('tenant role permission isolation from platform permissions', () => {
  it('never allows a tenant role to be granted a platform-only permission', () => {
    for (const key of DEFAULT_ROLE_PERMISSIONS.CLIENT_MASTER_ADMIN) {
      expect(TENANT_FORBIDDEN_PERMISSIONS.has(key)).toBe(false);
    }
  });

  it('rejects platform resources as grantable to tenant roles', () => {
    expect(isGrantableToTenantRole('tenants.view')).toBe(false);
    expect(isGrantableToTenantRole('system.edit')).toBe(false);
  });

  it('allows ordinary tenant resources', () => {
    expect(isGrantableToTenantRole('pos.create')).toBe(true);
    expect(isGrantableToTenantRole('products.view')).toBe(true);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS - least privilege shape', () => {
  it('Cashier cannot manage users or products', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('users.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('products.create');
  });

  it('Cashier can operate the POS and view sales', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain('pos.create');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain('sales.view');
  });

  it('Manager has refund and void authority; Cashier does not', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('sale.refund');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).toContain('sale.void');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('sale.refund');
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain('sale.void');
  });

  it('Inventory Staff can adjust stock but not run the POS', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.INVENTORY_STAFF).toContain('stock.adjust');
    expect(DEFAULT_ROLE_PERMISSIONS.INVENTORY_STAFF).not.toContain('pos.create');
  });

  it('Master Admin has license management; Client Master Admin does not', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MASTER_ADMIN).toContain('licenses.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.CLIENT_MASTER_ADMIN).not.toContain('licenses.manage');
  });
});

import {
  ADMIN_REGISTRY,
  derivePermissions,
  validateRightsSelection,
  BASELINE_PERMISSIONS,
} from '../src/index.js';

describe('administrator registry', () => {
  it('uses only catalog permissions that tenant roles may hold', () => {
    for (const m of ADMIN_REGISTRY)
      for (const item of m.items)
        for (const keys of Object.values(item.rights))
          for (const k of keys ?? []) {
            expect(PERMISSION_CATALOG).toContain(k);
            expect(isGrantableToTenantRole(k)).toBe(true);
          }
    for (const k of BASELINE_PERMISSIONS) expect(PERMISSION_CATALOG).toContain(k);
  });

  it('has unique module and item keys and every item supports Access', () => {
    const items = ADMIN_REGISTRY.flatMap((m) => m.items.map((i) => i.key));
    expect(new Set(items).size).toBe(items.length);
    expect(new Set(ADMIN_REGISTRY.map((m) => m.key)).size).toBe(ADMIN_REGISTRY.length);
    for (const m of ADMIN_REGISTRY) for (const i of m.items) expect(i.rights.access).toBeDefined();
  });

  it('grants nothing for unapproved modules, unknown keys or unsupported rights', () => {
    expect(() =>
      validateRightsSelection({ modules: [], items: { CATEGORIES: ['access'] } }),
    ).toThrow();
    expect(() => validateRightsSelection({ modules: ['NOPE'], items: {} })).toThrow();
    expect(() =>
      validateRightsSelection({ modules: ['MASTER'], items: { NOPE: ['access'] } }),
    ).toThrow();
    expect(() =>
      validateRightsSelection({ modules: ['MASTER'], items: { CATEGORIES: ['access', 'delete'] } }),
    ).toThrow();
    expect(() =>
      validateRightsSelection({ modules: ['MASTER'], items: { CATEGORIES: ['edit'] } }),
    ).toThrow();
  });

  it('derives exactly the ticked rights plus the baseline', () => {
    const perms = derivePermissions({
      modules: ['MASTER', 'SALE'],
      items: { CATEGORIES: ['access', 'add'], DAILY_SALES: ['access'], BRANDS: [] },
    });
    expect(perms).toEqual(['categories.create', 'categories.view', 'reports.daily', 'stores.view']);
  });
});

import { selectionFromPermissions } from '../src/index.js';
describe('selectionFromPermissions', () => {
  it('ticks a right only when all of its keys are held', () => {
    const sel = selectionFromPermissions([
      'sales.view',
      'sales.print',
      'sale_returns.view',
      'sale_returns.print',
      'sale.refund',
      'categories.view',
    ]);
    expect(sel.items.SALES).toEqual(['access', 'add']);
    expect(sel.items.CATEGORIES).toEqual(['access']);
    expect(sel.items.POS).toBeUndefined();
    expect(sel.modules.sort()).toEqual(['MASTER', 'SALE']);
  });
});
