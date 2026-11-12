/**
 * REAL PostgreSQL: a new Client Master Admin starts with NO automatic full rights; only the platform Master Admin can
 * assign them, and the user stays a Client Master Admin (shared owner role is updated, no private role swap).
 * Requires TEST_DATABASE_URL pointing at an ISOLATED, migrated database whose name contains "test"; otherwise skipped.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

try {
  const { loadExampleEnv } = await import('@mafk/database/load-example-env');
  loadExampleEnv();
} catch {
  /* not built yet */
}
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('client admin rights [real PostgreSQL]', () => {
    it.skip('SKIPPED: TEST_DATABASE_URL is not set (NOT VERIFIED)', () => undefined);
  });
} else {
  if (!/test/i.test(new URL(url).pathname))
    throw new Error('Refusing: database name must contain "test".');
  const { createPrismaClient } = await import('@mafk/database');
  const { createPrismaRepositories } =
    await import('../../src/infra/prisma/repositories-factory.js');
  const { AdminSecurityService } = await import('../../src/services/admin-security.service.js');
  const { PERMISSION_CATALOG, isGrantableToTenantRole } = await import('@mafk/shared');

  describe('client admin rights [real PostgreSQL]', () => {
    it('starts with the baseline only; the Master Admin assigns rights; a business admin cannot', async () => {
      const prisma = createPrismaClient({ databaseUrl: url });
      try {
        await prisma.permission.createMany({
          data: PERMISSION_CATALOG.map((key) => {
            const [resource, action] = key.split('.');
            return { key, resource: resource ?? key, action: action ?? 'view' };
          }),
          skipDuplicates: true,
        });
        const repos = createPrismaRepositories(prisma);
        const run = randomUUID().slice(0, 8);
        const made = await repos.tenantProvisioning.provision({
          code: `CR${run}`.toUpperCase(),
          name: `Rights ${run}`,
          defaultStoreName: 'Main',
          masterAdmin: { loginId: `owner.${run}`, passwordHash: 'x', displayName: 'Owner' },
          license: {
            planCode: 'STANDARD',
            expiresAt: new Date(Date.now() + 86_400_000),
            maxUsers: 5,
            maxDevices: 2,
            maxStores: 2,
            enabledModules: [],
          },
        } as never);

        const owner = await repos.users.findByLoginId(`owner.${run}`);
        expect(owner?.systemRole).toBe('CLIENT_MASTER_ADMIN');
        const keysOf = async (u: typeof owner) =>
          (await repos.roles.findById(u!.roleId, u!.tenantId))?.permissionKeys ?? [];
        expect(await keysOf(owner)).toEqual(['stores.view']); // nothing automatic

        const svc = new AdminSecurityService(repos, { hash: async (s: string) => s } as never);
        const all = new Set(PERMISSION_CATALOG.filter((k) => isGrantableToTenantRole(k)));
        const master = { id: 'm', tenantId: made.tenantId, permissions: all, platform: true };

        const saved = await svc.updateUser(master, made.clientAdminUserId, {
          rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } },
        } as never);
        expect(saved.systemRole).toBe('CLIENT_MASTER_ADMIN');
        expect(saved.effectivePermissions).toContain('brands.view');
        const again = await repos.users.findByLoginId(`owner.${run}`);
        expect(again?.systemRole).toBe('CLIENT_MASTER_ADMIN');
        const keys = await keysOf(again);
        expect(keys).toContain('brands.view');
        expect(keys).not.toContain('users.manage');

        const business = { ...master, platform: false, id: 'someone-else' };
        await expect(
          svc.updateUser(business, made.clientAdminUserId, {
            rights: { modules: [], items: {} },
          } as never),
        ).rejects.toMatchObject({ code: 'PROTECTED_USER' });
      } finally {
        await prisma.$disconnect();
      }
    });
  });
}
