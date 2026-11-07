/* eslint-disable no-console -- command-line diagnostic script; its output is the console */
// Read-only: reports what the target database already contains, as one JSON line. Needs DATABASE_URL.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const has = async (table) =>
  (await client.query(`select to_regclass($1) is not null as ok`, [`public.${table}`])).rows[0].ok;
const state = {
  migrationsTable: await has('_prisma_migrations'),
  core: (await has('tenants')) && (await has('users')) && (await has('sales')),
  admin: await has('user_categories'),
};
await client.end();
console.log(JSON.stringify(state));
