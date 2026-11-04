/**
 * Administrator module CONTRACT: Security File rights (levels 1-3), user categories, attribute locking, closed periods,
 * overhead, locations, logs. One suite, run against the in-memory fakes (tests/unit/admin.fake.test.ts) and against real
 * PostgreSQL (tests/integration/admin.pg.test.ts). It reuses the Phase 6 harness (tenants, branches, products, users).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDaysToYmd, localDateString, PERMISSION_CATALOG } from '@mafk/shared';
import type { CreateAdminUserInput } from '@mafk/validation';
import { DomainError } from '../../src/domain/types.js';
import { PasswordHasher } from '../../src/security/password.js';
import { AdminOperationsService, percentOf } from '../../src/services/admin-operations.service.js';
import { AdminSecurityService } from '../../src/services/admin-security.service.js';
import { ExpenseService } from '../../src/services/expense.service.js';
import { InventoryService } from '../../src/services/inventory.service.js';
import { ProductService } from '../../src/services/product.service.js';
import { SaleService } from '../../src/services/sale.service.js';
import type { Phase6Harness } from './phase6.contract.js';

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return (err as DomainError).code;
  }
  throw new Error('expected the promise to reject');
};

const hasher = new PasswordHasher({ memoryCostKib: 19456, timeCost: 2 });

export function describeAdminContract(
  backendName: string,
  createHarness: () => Promise<Phase6Harness>,
): void {
  describe(`administrator module [${backendName}]`, () => {
    let h: Phase6Harness;
    let security: AdminSecurityService;
    let ops: AdminOperationsService;
    let n = 0;

    const everything = () => new Set(PERMISSION_CATALOG);
    const owner = () => ({ id: h.actor.id, tenantId: h.actor.tenantId, permissions: everything() });
    const foreignOwner = () => ({
      id: h.otherTenantActor.id,
      tenantId: h.otherTenantActor.tenantId,
      permissions: everything(),
    });
    const today = (): string => localDateString(new Date(), h.timeZone);

    const newUser = (over: Partial<CreateAdminUserInput> = {}) => {
      n += 1;
      return security.createUser(owner(), {
        loginId: `cashier.${n}.${Math.random().toString(36).slice(2, 8)}`,
        displayName: `Cashier ${n}`,
        password: 'Str0ng-Passw0rd',
        rights: {
          modules: ['SALE', 'MASTER'],
          items: { POS: ['access', 'add'], CATEGORIES: ['access'], DAILY_SALES: ['access'] },
        },
        ...over,
      } as CreateAdminUserInput);
    };

    beforeEach(async () => {
      h = await createHarness();
      security = new AdminSecurityService(h.repos, hasher);
      ops = new AdminOperationsService(h.repos);
      await h.repos.inventory.applyMovement({
        tenantId: h.actor.tenantId,
        storeId: h.ids.storeId,
        productId: h.ids.productId,
        type: 'OPENING',
        quantityChange: '100',
        createdById: h.actor.id,
      });
    });
    afterAll(async () => {
      await h?.close();
    });

    describe('Security File: users and rights', () => {
      it('saves module / form / report rights and enforces exactly those permissions', async () => {
        const u = await newUser();
        expect(u.rightsSource).toBe('saved');
        expect(u.rights.modules.sort()).toEqual(['MASTER', 'SALE']);
        expect(u.rights.items).toMatchObject({
          POS: ['access', 'add'],
          CATEGORIES: ['access'],
          DAILY_SALES: ['access'],
        });
        // what the API enforces: the derived keys + the branch-lookup baseline, nothing else
        expect([...u.effectivePermissions].sort()).toEqual([
          'categories.view',
          'pos.create',
          'pos.view',
          'reports.daily',
          'stores.view',
        ]);
      });

      it('never stores or returns the FBR token, only whether one is set', async () => {
        const u = await newUser({ fbrToken: 'super-secret-token-9876' });
        expect(JSON.stringify(u)).not.toContain('super-secret-token');
        expect(u.profile.fbrTokenSet).toBe(true);
        expect(u.profile.fbrTokenHint).toBe('••••9876');
        const cleared = await security.updateUser(owner(), u.id, { fbrToken: null });
        expect(cleared.profile.fbrTokenSet).toBe(false);
      });

      it('rejects rights for a module that is not approved, unknown items and unsupported rights', async () => {
        expect(
          await code(newUser({ rights: { modules: ['MASTER'], items: { POS: ['access'] } } })),
        ).toBe('RIGHTS_INVALID');
        expect(
          await code(newUser({ rights: { modules: ['MASTER'], items: { NOPE: ['access'] } } })),
        ).toBe('RIGHTS_INVALID');
        expect(
          await code(
            newUser({
              rights: { modules: ['MASTER'], items: { CATEGORIES: ['access', 'delete'] } },
            }),
          ),
        ).toBe('RIGHTS_INVALID');
        expect(
          await code(newUser({ rights: { modules: ['MASTER'], items: { CATEGORIES: ['edit'] } } })),
        ).toBe('RIGHTS_INVALID');
      });

      it('lets nobody grant a right they do not hold themselves', async () => {
        const limited = {
          ...owner(),
          permissions: new Set(['security_file.create', 'security_file.view', 'categories.view']),
        };
        const ok = await security.createUser(limited, {
          loginId: `lim.${Math.random().toString(36).slice(2, 8)}`,
          displayName: 'Limited grant',
          password: 'Str0ng-Passw0rd',
          rights: { modules: ['MASTER'], items: { CATEGORIES: ['access'] } },
        } as CreateAdminUserInput);
        expect(ok.effectivePermissions).toContain('categories.view');
        expect(
          await code(
            security.createUser(limited, {
              loginId: `lim2.${Math.random().toString(36).slice(2, 8)}`,
              displayName: 'Too much',
              password: 'Str0ng-Passw0rd',
              rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } },
            } as CreateAdminUserInput),
          ),
        ).toBe('RIGHTS_ESCALATION');
      });

      it('replaces rights on update without touching the shared role other users hold', async () => {
        const a = await h.newUserId();
        const b = await h.newUserId();
        const before = await security.getUser(owner(), b);
        const updated = await security.updateUser(owner(), a, {
          rights: { modules: ['MASTER'], items: { BRANDS: ['access', 'add'] } },
        });
        expect([...updated.effectivePermissions].sort()).toEqual([
          'brands.create',
          'brands.view',
          'stores.view',
        ]);
        const afterB = await security.getUser(owner(), b);
        expect(afterB.effectivePermissions).toEqual(before.effectivePermissions);
        // a second save replaces, it does not add
        const again = await security.updateUser(owner(), a, {
          rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } },
        });
        expect([...again.effectivePermissions].sort()).toEqual(['brands.view', 'stores.view']);
      });

      it('does not let an administrator change their own rights', async () => {
        const self = await h.newUserId();
        const actor = { ...owner(), id: self };
        expect(
          await code(
            security.updateUser(actor, self, {
              rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } },
            }),
          ),
        ).toBe('PROTECTED_USER');
        expect(await code(security.deleteUser(actor, self))).toBe('PROTECTED_USER');
      });

      it('rejects a duplicate Login ID', async () => {
        const u = await newUser();
        expect(await code(newUser({ loginId: u.loginId }))).toBe('LOGIN_ID_TAKEN');
      });

      it('lists, searches, disables and soft-deletes users', async () => {
        const u = await newUser({ loginId: `findme.${Math.random().toString(36).slice(2, 6)}` });
        const found = await security.listUsers(h.actor.tenantId, {
          q: 'findme',
          includeDisabled: false,
        });
        expect(found.map((r) => r.id)).toEqual([u.id]);
        await security.updateUser(owner(), u.id, { status: 'DISABLED' });
        expect(
          (await security.listUsers(h.actor.tenantId, { q: 'findme', includeDisabled: false }))
            .length,
        ).toBe(0);
        expect(
          (await security.listUsers(h.actor.tenantId, { q: 'findme', includeDisabled: true }))
            .length,
        ).toBe(1);
        await security.deleteUser(owner(), u.id);
        expect(
          (await security.listUsers(h.actor.tenantId, { q: 'findme', includeDisabled: true }))
            .length,
        ).toBe(0);
        expect(await code(security.getUser(owner(), u.id))).toBe('NOT_FOUND');
      });

      it('keeps tenants apart: another business cannot read, change or delete the user', async () => {
        const u = await newUser();
        expect(await code(security.getUser(foreignOwner(), u.id))).toBe('NOT_FOUND');
        expect(
          await code(security.updateUser(foreignOwner(), u.id, { displayName: 'Hacked' })),
        ).toBe('NOT_FOUND');
        expect(await code(security.deleteUser(foreignOwner(), u.id))).toBe('NOT_FOUND');
        expect(
          (await security.listUsers(h.otherTenantActor.tenantId, { includeDisabled: true })).some(
            (r) => r.id === u.id,
          ),
        ).toBe(false);
        expect((await security.getUser(owner(), u.id)).displayName).toBe(u.displayName);
      });

      it('rejects a location or user type from another business', async () => {
        const foreignCat = await ops.listCategories(h.otherTenantActor.tenantId);
        expect(
          await code(
            newUser({ userCategoryId: foreignCat[0]!.id } as Partial<CreateAdminUserInput>),
          ),
        ).toBe('VALIDATION_ERROR');
      });
    });

    describe('User Category and locations', () => {
      it('starts with a usable set, rejects duplicates, and protects categories in use', async () => {
        const list = await ops.listCategories(h.actor.tenantId);
        expect(list.length).toBeGreaterThan(0);
        expect(await code(ops.createCategory(owner(), { code: list[0]!.code, name: 'Dup' }))).toBe(
          'CONFLICT',
        );
        const created = await ops.createCategory(owner(), { code: 'TEMP_X', name: 'Temp' });
        const user = await newUser({ userCategoryId: created.id } as Partial<CreateAdminUserInput>);
        expect((await security.getUser(owner(), user.id)).categoryName).toBe('Temp');
        expect(await code(ops.deleteCategory(owner(), created.id))).toBe('CONFLICT');
        await ops.updateCategory(owner(), created.id, { isActive: false });
        const free = await ops.createCategory(owner(), { code: 'TEMP_Y', name: 'Free' });
        await ops.deleteCategory(owner(), free.id);
        expect((await ops.listCategories(h.actor.tenantId)).some((c) => c.id === free.id)).toBe(
          false,
        );
      });

      it('updates a user location, only to an active branch of the same business', async () => {
        const u = await newUser();
        await ops.updateUserLocation(owner(), u.id, h.ids.otherStoreId);
        expect((await security.getUser(owner(), u.id)).storeId).toBe(h.ids.otherStoreId);
        await ops.setLocationActive(owner(), h.ids.otherStoreId, false);
        expect(await code(ops.updateUserLocation(owner(), u.id, h.ids.otherStoreId))).toBe(
          'VALIDATION_ERROR',
        );
        expect(await code(ops.updateUserLocation(owner(), u.id, 'no-such-store'))).toBe(
          'VALIDATION_ERROR',
        );
      });

      it('lists locations with user counts, protects the default and the last active one', async () => {
        const locations = await ops.listLocations(h.actor.tenantId);
        expect(locations.length).toBeGreaterThanOrEqual(2);
        const def = locations.find((l) => l.isDefault)!;
        expect(await code(ops.setLocationActive(owner(), def.id, false))).toBe('CONFLICT');
        await ops.setLocationActive(owner(), h.ids.otherStoreId, false);
        expect(
          (await ops.listLocations(h.actor.tenantId)).find((l) => l.id === h.ids.otherStoreId)!
            .isActive,
        ).toBe(false);
        expect(await code(ops.setLocationActive(foreignOwner(), h.ids.otherStoreId, true))).toBe(
          'NOT_FOUND',
        );
      });
    });

    describe('Attribute Locking', () => {
      it('blocks changing a locked attribute, allows unchanged values, and unlocks again', async () => {
        const products = new ProductService(h.repos);
        const before = await h.repos.products.findById(h.ids.productId, h.actor.tenantId);
        expect(await code(ops.setLocks(owner(), ['product.nope']).then(() => 'x'))).toBe(
          'VALIDATION_ERROR',
        );
        await ops.setLocks(owner(), ['product.selling_price']);
        expect((await ops.getLocks(h.actor.tenantId)).locked).toEqual(['product.selling_price']);
        expect(
          await code(products.update(h.actor, h.ids.productId, { sellingPrice: '123.00' })),
        ).toBe('ATTRIBUTE_LOCKED');
        // resending the same price is not a change; an unlocked attribute still edits
        await products.update(h.actor, h.ids.productId, {
          sellingPrice: before!.sellingPrice,
          name: 'Renamed',
        });
        expect((await h.repos.products.findById(h.ids.productId, h.actor.tenantId))!.name).toBe(
          'Renamed',
        );
        await ops.setLocks(owner(), []);
        await products.update(h.actor, h.ids.productId, { sellingPrice: '123.00' });
        expect(
          Number(
            (await h.repos.products.findById(h.ids.productId, h.actor.tenantId))!.sellingPrice,
          ),
        ).toBe(123);
      });
    });

    describe('Close Period for Transaction', () => {
      it('rejects transactions in a closed period and allows them again after re-opening', async () => {
        const expenses = new ExpenseService(h.repos);
        const sales = new SaleService(h.repos);
        const inv = new InventoryService(h.repos);
        const old = addDaysToYmd(today(), -3);
        const exp = (day: string) =>
          expenses.create(h.actor, {
            storeId: h.ids.storeId,
            category: 'Rent',
            amount: '10.00',
            expenseDate: day,
            method: 'CASH',
          });
        const open = await exp(old);

        await ops.closePeriod(owner(), addDaysToYmd(today(), -1));
        expect(await code(exp(old))).toBe('PERIOD_CLOSED');
        expect(await code(expenses.update(h.actor, open.id, { amount: '11.00' }))).toBe(
          'PERIOD_CLOSED',
        );
        expect(await code(expenses.delete(h.actor, open.id))).toBe('PERIOD_CLOSED');
        await exp(today()); // an open day still works
        await sales.createSale(h.actor, {
          clientRequestId: `cp-${Math.random()}`,
          storeId: h.ids.storeId,
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CASH', amount: '100.00' }],
        });
        expect(await code(ops.closePeriod(owner(), addDaysToYmd(today(), -2)))).toBe(
          'VALIDATION_ERROR',
        );
        expect(await code(ops.closePeriod(owner(), addDaysToYmd(today(), 1)))).toBe(
          'VALIDATION_ERROR',
        );
        expect((await ops.getPeriod(h.actor.tenantId)).closedThrough).toBe(
          addDaysToYmd(today(), -1),
        );

        await ops.reopenPeriod(owner());
        await exp(old);
        expect(await code(ops.reopenPeriod(owner()))).toBe('NOT_FOUND');
        void inv;
      });

      it('keeps one business’s closed period from affecting another', async () => {
        await ops.closePeriod(owner(), addDaysToYmd(today(), -1));
        expect((await ops.getPeriod(h.otherTenantActor.tenantId)).closedThrough).toBeNull();
      });
    });

    describe('Generate Overhead', () => {
      it('computes expenses / net sales x 100 from the Profit & Loss figures and keeps the run', async () => {
        const expenses = new ExpenseService(h.repos);
        const sales = new SaleService(h.repos);
        expect(await code(ops.generateOverhead(owner(), { from: today(), to: today() }))).toBe(
          'NO_SALES_IN_PERIOD',
        );
        await sales.createSale(h.actor, {
          clientRequestId: `oh-${Math.random()}`,
          storeId: h.ids.storeId,
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CASH', amount: '100.00' }],
        });
        await expenses.create(h.actor, {
          storeId: h.ids.storeId,
          category: 'Rent',
          amount: '25.00',
          expenseDate: today(),
          method: 'CASH',
        });
        const run = await ops.generateOverhead(owner(), {
          from: today(),
          to: today(),
          notes: 'test',
        });
        expect(run).toMatchObject({
          totalExpenses: '25.00',
          totalSales: '100.00',
          ratePercent: '25.0000',
        });
        expect((await ops.listOverheadRuns(h.actor.tenantId)).map((r) => r.id)).toEqual([run.id]);
        expect((await ops.listOverheadRuns(h.otherTenantActor.tenantId)).length).toBe(0);
        expect(await code(ops.deleteOverheadRun(foreignOwner(), run.id))).toBe('NOT_FOUND');
        await ops.deleteOverheadRun(owner(), run.id);
        expect((await ops.listOverheadRuns(h.actor.tenantId)).length).toBe(0);
      });

      it('does the percentage math with integers', () => {
        expect(percentOf('25.00', '100.00')).toBe('25.0000');
        expect(percentOf('1.00', '3.00')).toBe('33.3333');
        expect(percentOf('0.00', '10.00')).toBe('0.0000');
        expect(percentOf('2.00', '3.00')).toBe('66.6667');
      });
    });

    describe('Logs', () => {
      it('records Administrator actions in the Log File, newest first, scoped to the business', async () => {
        const u = await newUser();
        await ops.setLocks(owner(), ['product.unit']);
        const log = await ops.auditLog(h.actor.tenantId, { limit: 50 });
        const actions = log.map((r) => r.action);
        expect(actions).toContain('ADMIN_USER_CREATED');
        expect(actions).toContain('ATTRIBUTE_LOCKS_CHANGED');
        const times = log.map((r) => r.createdAt.getTime());
        expect(times).toEqual([...times].sort((a, b) => b - a));
        expect(JSON.stringify(log)).not.toContain('Str0ng-Passw0rd');
        const filtered = await ops.auditLog(h.actor.tenantId, { q: 'attribute_locks', limit: 50 });
        expect(filtered.every((r) => r.action === 'ATTRIBUTE_LOCKS_CHANGED')).toBe(true);
        expect(
          (await ops.auditLog(h.otherTenantActor.tenantId, { limit: 50 })).some(
            (r) => r.entityId === u.id,
          ),
        ).toBe(false);
      });

      it('SMS log lists only what was recorded and is empty otherwise', async () => {
        expect(await ops.smsLog(h.actor.tenantId, { limit: 50 })).toEqual([]);
        await h.repos.admin.recordSms(h.actor.tenantId, {
          recipient: '03001234567',
          message: 'Your bill is ready',
          status: 'SENT',
        });
        const rows = await ops.smsLog(h.actor.tenantId, { limit: 50 });
        expect(rows.map((r) => r.recipient)).toEqual(['03001234567']);
        expect(await ops.smsLog(h.otherTenantActor.tenantId, { limit: 50 })).toEqual([]);
      });

      it('Bank log shows only card / bank-transfer money, from sales payments and expenses', async () => {
        const sales = new SaleService(h.repos);
        const expenses = new ExpenseService(h.repos);
        await sales.createSale(h.actor, {
          clientRequestId: `bk-${Math.random()}`,
          storeId: h.ids.storeId,
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CARD', amount: '100.00', reference: 'AUTH-1' }],
        });
        await sales.createSale(h.actor, {
          clientRequestId: `bk-${Math.random()}`,
          storeId: h.ids.storeId,
          items: [{ productId: h.ids.productId, quantity: '1' }],
          payments: [{ method: 'CASH', amount: '100.00' }],
        });
        await expenses.create(h.actor, {
          storeId: h.ids.storeId,
          category: 'Utilities',
          amount: '40.00',
          expenseDate: today(),
          method: 'BANK_TRANSFER',
        });
        const rows = await ops.bankLog(h.actor.tenantId, { limit: 50 });
        expect(rows.map((r) => `${r.source}:${r.method}:${r.amount}`).sort()).toEqual([
          'EXPENSE:BANK_TRANSFER:40.00',
          'SALE_PAYMENT:CARD:100.00',
        ]);
        expect(await ops.bankLog(h.otherTenantActor.tenantId, { limit: 50 })).toEqual([]);
      });
    });
  });
}
