// Idempotent: safe to run multiple times. Seeds only platform-level, non-tenant
// data (the permission catalog). Tenant creation, licenses and the first Client
// Master Admin are created via the Master Admin API/UI in later phases, not here -
// per the spec, there must be no hardcoded business data or default tenants.
import { isGrantableToTenantRole, PERMISSION_CATALOG } from '@mafk/shared';
import { createPrismaClient } from './client.js';
import { loadExampleEnv } from './load-example-env.js';

loadExampleEnv(); // local dev defaults from .env.example (real environment variables still win)

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed.');

  const prisma = createPrismaClient({ databaseUrl });
  try {
    let created = 0;
    for (const key of PERMISSION_CATALOG) {
      const [resource, action] = key.split('.');
      const result = await prisma.permission.upsert({
        where: { key },
        create: { key, resource: resource ?? key, action: action ?? 'view' },
        update: {},
      });
      if (result) created += 1;
    }

    // Businesses created before a permission existed (for example the Administrator permissions) keep their Client
    // Master Admin role; give it every grantable permission so the owner is never locked out of a new screen. Only the
    // owner role is touched: Manager, Cashier, Inventory Staff and per-user roles are left exactly as they are.
    const grantable = await prisma.permission.findMany({
      where: { key: { in: PERMISSION_CATALOG.filter((k) => isGrantableToTenantRole(k)) } },
      select: { id: true },
    });
    const ownerRoles = await prisma.role.findMany({
      where: { systemRole: 'CLIENT_MASTER_ADMIN', tenantId: { not: null } },
      select: { id: true },
    });
    let granted = 0;
    for (const role of ownerRoles) {
      const res = await prisma.rolePermission.createMany({
        data: grantable.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      granted += res.count;
    }
    // eslint-disable-next-line no-console -- seed scripts are console-driven CLI tools
    console.log(
      `Owner roles synced: ${ownerRoles.length} role(s), ${granted} permission(s) added.`,
    );
    // eslint-disable-next-line no-console -- seed scripts are console-driven CLI tools
    console.log(
      `Seed complete. Permission catalog: ${created}/${PERMISSION_CATALOG.length} entries ensured.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
