/**
 * REAL PostgreSQL integration test for the Administrator module (Security File rights, categories, locking, closed
 * periods, overhead, locations, logs). Same contract as the in-memory run, through the Prisma adapters.
 * Requires TEST_DATABASE_URL pointing at an ISOLATED, migrated database whose name contains "test"; otherwise skipped.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@mafk/database';
import { describe, it } from 'vitest';
import { describeAdminContract } from '../contract/admin.contract.js';
import type { Phase6Harness } from '../contract/phase6.contract.js';

try {
  const { loadExampleEnv } = await import('@mafk/database/load-example-env');
  loadExampleEnv();
} catch {
  /* not built yet - suite is reported as skipped */
}

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('administrator module [real PostgreSQL]', () => {
    it.skip('SKIPPED: TEST_DATABASE_URL is not set (NOT VERIFIED)', () => undefined);
  });
} else {
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL database "${dbName}" does not contain "test".`,
    );
  }
  const { createPrismaClient } = await import('@mafk/database');
  const { createPrismaRepositories } =
    await import('../../src/infra/prisma/repositories-factory.js');
  const { PERMISSION_CATALOG } = await import('@mafk/shared');
  let prisma: PrismaClient | null = null;
  const client = (): PrismaClient => (prisma ??= createPrismaClient({ databaseUrl: url }));

  const createHarness = async (): Promise<Phase6Harness> => {
    const p = client();
    // the permission catalog must exist (db:seed does this in a real setup)
    await p.permission.createMany({
      data: PERMISSION_CATALOG.map((key) => {
        const [resource, action] = key.split('.');
        return { key, resource: resource ?? key, action: action ?? 'view' };
      }),
      skipDuplicates: true,
    });
    const run = randomUUID().slice(0, 8);
    const tenantA = await p.tenant.create({ data: { code: `AA${run}`, name: `Tenant A ${run}` } });
    const tenantB = await p.tenant.create({ data: { code: `AB${run}`, name: `Tenant B ${run}` } });
    const store = await p.store.create({
      data: { tenantId: tenantA.id, code: 'MAIN', name: 'Main', isDefault: true },
    });
    const otherStore = await p.store.create({
      data: { tenantId: tenantA.id, code: 'BR2', name: 'Branch 2' },
    });
    await p.store.create({
      data: { tenantId: tenantB.id, code: 'MAIN', name: 'Main B', isDefault: true },
    });
    const category = await p.category.create({ data: { tenantId: tenantA.id, name: 'Cat' } });
    const sub = await p.subDepartment.create({
      data: { tenantId: tenantA.id, categoryId: category.id, name: 'Sub' },
    });
    const mkProduct = (name: string, selling: string, tax: string) =>
      p.product.create({
        data: {
          tenantId: tenantA.id,
          name,
          sku: `${name}-${run}`,
          categoryId: category.id,
          subDepartmentId: sub.id,
          costPrice: '10',
          sellingPrice: selling,
          taxRate: tax,
        },
      });
    const product1 = await mkProduct('P1', '100', '0');
    const product2 = await mkProduct('P2', '40', '10');
    const role = await p.role.create({
      data: { tenantId: tenantA.id, key: `r-${run}`, name: 'Staff', systemRole: 'CUSTOM' },
    });
    const full = new Set([
      'pos.create',
      'discount.apply',
      'price.change',
      'sale.refund',
      'customers.edit',
      'employees.edit',
      'reports.view',
      'reports.export',
    ]);
    return {
      repos: createPrismaRepositories(p),
      actor: { id: `actor-${run}`, tenantId: tenantA.id, permissions: full },
      limitedActor: {
        id: `cashier-${run}`,
        tenantId: tenantA.id,
        permissions: new Set(['pos.create']),
      },
      otherTenantActor: { id: `actor-b-${run}`, tenantId: tenantB.id, permissions: full },
      ids: {
        storeId: store.id,
        otherStoreId: otherStore.id,
        productId: product1.id,
        productId2: product2.id,
      },
      timeZone: 'Asia/Karachi',
      faults: { failAuditWrite: async () => async () => undefined },
      setSoldAt: async (saleId, at) => {
        await p.sale.update({ where: { id: saleId }, data: { soldAt: at } });
      },
      newUserId: async () => {
        const id = randomUUID().slice(0, 8);
        const u = await p.user.create({
          data: {
            tenantId: tenantA.id,
            roleId: role.id,
            loginId: `emp.${id}.${run}`,
            displayName: `Emp ${id}`,
            passwordHash: 'not-a-real-hash',
          },
        });
        return u.id;
      },
      close: async () => {
        await prisma?.$disconnect();
        prisma = null;
      },
    };
  };

  describeAdminContract('real PostgreSQL', createHarness);
}
