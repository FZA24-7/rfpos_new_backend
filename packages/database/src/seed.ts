// Idempotent: safe to run multiple times. Seeds only platform-level, non-tenant
// data (the permission catalog). Tenant creation, licenses and the first Client
// Master Admin are created via the Master Admin API/UI in later phases, not here -
// per the spec, there must be no hardcoded business data or default tenants.
import { PERMISSION_CATALOG } from '@mafk/shared';
import { createPrismaClient } from './client.js';
import { loadExampleEnv } from './load-example-env.js';

loadExampleEnv(); // local dev defaults from .env.example (real environment variables still win)

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed.');

  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
  try {
    // Bulk statements (a handful of round trips) instead of one upsert per permission: over a remote pooler such as
    // Supabase's, hundreds of tiny round trips are slow and the connection can be dropped part-way.
    const wanted = PERMISSION_CATALOG.map((key) => {
      const [resource, action] = key.split('.');
      return { key, resource: resource ?? key, action: action ?? 'view' };
    });
    const before = await prisma.permission.count();
    await prisma.permission.createMany({ data: wanted, skipDuplicates: true });
    const added = (await prisma.permission.count()) - before;

    // Rights are NEVER granted automatically any more: the Master Admin assigns each Client Master Admin's rights
    // (Master Admin > client > Security File). Existing owners keep exactly what they already hold.
    // eslint-disable-next-line no-console -- seed scripts are console-driven CLI tools
    console.log(
      `Seed complete. Permission catalog: ${PERMISSION_CATALOG.length} entries ensured (${added} new).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** A dropped connection is retried (the seed is idempotent, so running it again is safe). */
async function run(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await main();
      return;
    } catch (err) {
      if (attempt >= 3 || !String(err).includes('Connection terminated')) throw err;
      // eslint-disable-next-line no-console -- seed scripts are console-driven CLI tools
      console.log(`Connection dropped, retrying (${attempt}/2)...`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
