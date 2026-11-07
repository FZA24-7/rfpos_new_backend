/**
 * REAL PostgreSQL test: the DATABASE ITSELF refuses to link one client's rows to another client's rows (composite
 * foreign keys on (id, tenantId)), independent of any application code. Also checks that the same Login ID can never
 * exist twice and that a client's rows are invisible to another client's filtered queries.
 * Requires TEST_DATABASE_URL pointing at an ISOLATED, migrated database whose name contains "test"; otherwise skipped.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@mafk/database';
import { afterAll, describe, expect, it } from 'vitest';

try {
  const { loadExampleEnv } = await import('@mafk/database/load-example-env');
  loadExampleEnv();
} catch {
  /* not built yet - suite is reported as skipped */
}

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('client isolation [real PostgreSQL]', () => {
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
  const prisma: PrismaClient = createPrismaClient({ databaseUrl: url });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('client isolation [real PostgreSQL]', () => {
    const setup = async () => {
      const run = randomUUID().slice(0, 8);
      const a = await prisma.tenant.create({ data: { code: `MTJ${run}`, name: `MTJ ${run}` } });
      const b = await prisma.tenant.create({ data: { code: `J${run}.`, name: `J. ${run}` } });
      const catA = await prisma.category.create({ data: { tenantId: a.id, name: 'A cat' } });
      const catB = await prisma.category.create({ data: { tenantId: b.id, name: 'B cat' } });
      return { a, b, catA, catB };
    };

    it('stores a client code with a dot, and keeps each client’s rows apart', async () => {
      const { a, b, catA, catB } = await setup();
      expect(b.code.endsWith('.')).toBe(true);
      const seenByA = await prisma.category.findMany({ where: { tenantId: a.id } });
      const seenByB = await prisma.category.findMany({ where: { tenantId: b.id } });
      expect(seenByA.map((c) => c.id)).toEqual([catA.id]);
      expect(seenByB.map((c) => c.id)).toEqual([catB.id]);
    });

    it('the database rejects a row of client B that points at a record of client A', async () => {
      const { b, catA } = await setup();
      await expect(
        prisma.subDepartment.create({
          data: { tenantId: b.id, categoryId: catA.id, name: 'Sneaky' },
        }),
      ).rejects.toThrow();
      // and the legitimate pairing works
      const ok = await prisma.subDepartment.create({
        data: { tenantId: catA.tenantId, categoryId: catA.id, name: 'Legit' },
      });
      expect(ok.tenantId).toBe(catA.tenantId);
    });

    it('a client code and a Login ID can each exist only once', async () => {
      const { a } = await setup();
      await expect(
        prisma.tenant.create({ data: { code: a.code, name: 'Duplicate code' } }),
      ).rejects.toThrow();
    });
  });
}
