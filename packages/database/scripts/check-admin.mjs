/* eslint-disable no-console -- command-line diagnostic script; its output is the console */
// Read-only check: which users have the Administrator permissions? Usage: set DATABASE_URL, then
//   pnpm --filter @mafk/database exec node scripts/check-admin.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const perms = await client.query(
  `select count(*)::int as n from permissions where key like 'security_file.%'`,
);
console.log('security_file permissions in database:', perms.rows[0].n, '(expected 4)');
const rows = await client.query(`
  select u."loginId", u.status, r."systemRole", r.key as role_key,
    (select count(*)::int from role_permissions rp join permissions p on p.id = rp."permissionId"
       where rp."roleId" = r.id and p.key = 'security_file.view') as has_security_file,
    (select count(*)::int from role_permissions rp where rp."roleId" = r.id) as total_permissions
  from users u join roles r on r.id = u."roleId"
  where u."tenantId" is not null
  order by u."loginId"`);
console.table(rows.rows);
await client.end();
