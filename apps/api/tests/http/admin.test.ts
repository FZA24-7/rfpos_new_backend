import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

const PASSWORD = 'Str0ng-Passw0rd';

const token = async (app: Express, loginId: string, password: string): Promise<string> => {
  const res = await loginAs(app, loginId, password);
  expect(res.status).toBe(200);
  return `Bearer ${res.body.accessToken as string}`;
};

describe('Administrator HTTP: rights are enforced by the API', () => {
  it('lets only holders of security_file.* open the Security File', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await token(app, s.tenantACashier.loginId, s.tenantACashier.password);
    const manager = await token(app, s.tenantAManager.loginId, s.tenantAManager.password);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    for (const t of [cashier, manager]) {
      expect((await request(app).get('/api/admin/users').set('Authorization', t)).status).toBe(403);
      expect((await request(app).get('/api/admin/registry').set('Authorization', t)).status).toBe(
        403,
      );
      expect((await request(app).get('/api/admin/logs/audit').set('Authorization', t)).status).toBe(
        403,
      );
    }
    expect((await request(app).get('/api/admin/users').set('Authorization', admin)).status).toBe(
      200,
    );
    // the master admin (no tenant) has no business data to administer
    const master = await token(app, s.masterAdmin.loginId, s.masterAdmin.password);
    expect((await request(app).get('/api/admin/users').set('Authorization', master)).status).toBe(
      403,
    );
  });

  it('serves the real module / form / report structure, with only supported rights', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const res = await request(app).get('/api/admin/registry').set('Authorization', admin);
    expect(res.status).toBe(200);
    const modules = res.body.modules as {
      key: string;
      items: { key: string; kind: string; rights: string[] }[];
    }[];
    const adminModule = modules.find((m) => m.key === 'ADMIN')!;
    expect(adminModule.items.filter((i) => i.kind === 'report')).toEqual([]); // no reports -> none shown
    expect(adminModule.items.find((i) => i.key === 'LOG_FILE')!.rights).toEqual(['access']);
    const sale = modules.find((m) => m.key === 'SALE')!;
    expect(sale.items.filter((i) => i.kind === 'report').length).toBeGreaterThan(0);
    for (const i of sale.items.filter((x) => x.kind === 'report'))
      expect(i.rights).toEqual(['access']);
    expect(modules.every((m) => m.items.length > 0)).toBe(true);
  });

  it('serves active branches and user types for the Security File drop-downs', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const cashier = await token(app, s.tenantACashier.loginId, s.tenantACashier.password);
    const res = await request(app).get('/api/admin/security/lookups').set('Authorization', admin);
    expect(res.status).toBe(200);
    expect(res.body.locations.map((l: { id: string }) => l.id)).toContain(s.tenantA.storeId);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(
      (await request(app).get('/api/admin/security/lookups').set('Authorization', cashier)).status,
    ).toBe(403);
  });

  it('a user created in the Security File can use exactly what was ticked and nothing else', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);

    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', admin)
      .send({
        loginId: 'clerk.one',
        displayName: 'Clerk One',
        password: PASSWORD,
        rights: {
          modules: ['MASTER', 'SALE'],
          items: { CATEGORIES: ['access'], DAILY_SALES: ['access'] },
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.passwordHash).toBeUndefined();

    const login = await loginAs(app, 'clerk.one', PASSWORD);
    expect(login.status).toBe(200);
    expect([...(login.body.user.permissions as string[])].sort()).toEqual([
      'categories.view',
      'reports.daily',
      'stores.view',
    ]);
    const clerk = `Bearer ${login.body.accessToken as string}`;
    const range = 'from=2026-01-01&to=2026-01-31';

    // ticked: allowed
    expect(
      (await request(app).get('/api/catalog/categories').set('Authorization', clerk)).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/reports/daily?${range}`).set('Authorization', clerk)).status,
    ).toBe(200);
    // add right not ticked
    expect(
      (
        await request(app)
          .post('/api/catalog/categories')
          .set('Authorization', clerk)
          .send({ name: 'X' })
      ).status,
    ).toBe(403);
    // other reports, other forms, other modules and the Administrator: refused
    for (const url of [
      `/api/reports/profit-loss?${range}`,
      `/api/reports/sales-summary?${range}`,
      '/api/catalog/brands',
      '/api/catalog/products',
      '/api/customers',
      '/api/expenses',
      '/api/admin/users',
      '/api/admin/logs/audit',
    ]) {
      expect((await request(app).get(url).set('Authorization', clerk)).status, url).toBe(403);
    }
  });

  it('Update User Location works on its own: it can pick users and locations but not open the Security File', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const made = await request(app)
      .post('/api/admin/users')
      .set('Authorization', admin)
      .send({
        loginId: 'mover.one',
        displayName: 'Mover One',
        password: PASSWORD,
        rights: { modules: ['ADMIN'], items: { UPDATE_USER_LOCATION: ['access', 'edit'] } },
      });
    expect(made.status).toBe(201);
    const mover = await token(app, 'mover.one', PASSWORD);
    const get = (url: string) => request(app).get(url).set('Authorization', mover);
    expect((await get('/api/admin/users')).status).toBe(200);
    expect((await get('/api/admin/security/lookups')).status).toBe(200);
    expect((await get('/api/admin/registry')).status).toBe(403);
    expect((await get('/api/admin/user-categories')).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/admin/users')
          .set('Authorization', mover)
          .send({ loginId: 'x.y', displayName: 'X Y', password: PASSWORD })
      ).status,
    ).toBe(403);
  });

  it('shared roles keep working: the broad reports.view still opens every report', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const manager = await token(app, s.tenantAManager.loginId, s.tenantAManager.password);
    for (const p of ['daily', 'profit-loss', 'sales-summary']) {
      expect(
        (
          await request(app)
            .get(`/api/reports/${p}?from=2026-01-01&to=2026-01-31`)
            .set('Authorization', manager)
        ).status,
      ).toBe(200);
    }
  });

  it('cannot grant what the caller does not hold, edit the owner or oneself, and hides other businesses', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);

    // a delegate who may only add users and see Master Files > Categories
    const delegate = await request(app)
      .post('/api/admin/users')
      .set('Authorization', admin)
      .send({
        loginId: 'delegate.one',
        displayName: 'Delegate',
        password: PASSWORD,
        rights: {
          modules: ['ADMIN', 'MASTER'],
          items: { SECURITY_FILE: ['access', 'add', 'edit', 'delete'], CATEGORIES: ['access'] },
        },
      });
    expect(delegate.status).toBe(201);
    const d = await token(app, 'delegate.one', PASSWORD);

    const tooMuch = await request(app)
      .post('/api/admin/users')
      .set('Authorization', d)
      .send({
        loginId: 'greedy',
        displayName: 'Greedy',
        password: PASSWORD,
        rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } },
      });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error.code).toBe('RIGHTS_ESCALATION');

    // own rights and the owner's account are protected
    expect(
      (
        await request(app)
          .patch(`/api/admin/users/${delegate.body.id as string}`)
          .set('Authorization', d)
          .send({ rights: { modules: ['MASTER'], items: { CATEGORIES: ['access'] } } })
      ).body.error.code,
    ).toBe('PROTECTED_USER');
    const ownerRow = await request(app)
      .get(`/api/admin/users/${s.tenantAClientAdmin.id}`)
      .set('Authorization', d);
    expect(ownerRow.status).toBe(200);
    expect(ownerRow.body.rightsEditable).toBe(false);
    expect(
      (
        await request(app)
          .patch(`/api/admin/users/${s.tenantAClientAdmin.id}`)
          .set('Authorization', d)
          .send({ rights: { modules: [], items: {} } })
      ).body.error.code,
    ).toBe('PROTECTED_USER');
    expect(
      (
        await request(app)
          .delete(`/api/admin/users/${s.tenantAClientAdmin.id}`)
          .set('Authorization', d)
      ).status,
    ).toBe(403);

    // another business: invisible
    const bAdmin = await token(app, s.tenantBClientAdmin.loginId, s.tenantBClientAdmin.password);
    expect(
      (
        await request(app)
          .get(`/api/admin/users/${delegate.body.id as string}`)
          .set('Authorization', bAdmin)
      ).status,
    ).toBe(404);
  });

  it('changing rights ends the user’s sessions, and a disabled or deleted user cannot sign in', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const made = await request(app)
      .post('/api/admin/users')
      .set('Authorization', admin)
      .send({
        loginId: 'temp.user',
        displayName: 'Temp',
        password: PASSWORD,
        rights: { modules: ['MASTER'], items: { CATEGORIES: ['access'] } },
      });
    const first = await loginAs(app, 'temp.user', PASSWORD);
    const cookie = (first.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

    await request(app)
      .patch(`/api/admin/users/${made.body.id as string}`)
      .set('Authorization', admin)
      .send({ rights: { modules: ['MASTER'], items: { BRANDS: ['access'] } } })
      .expect(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    const relogin = await loginAs(app, 'temp.user', PASSWORD);
    expect(relogin.body.user.permissions).toContain('brands.view');
    expect(relogin.body.user.permissions).not.toContain('categories.view');

    await request(app)
      .patch(`/api/admin/users/${made.body.id as string}`)
      .set('Authorization', admin)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect((await loginAs(app, 'temp.user', PASSWORD)).status).toBe(403);
  });

  it('validates input: weak password, bad Login ID, unknown right', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    const base = { displayName: 'Valid Name', rights: { modules: [], items: {} } };
    const post = (b: object) =>
      request(app).post('/api/admin/users').set('Authorization', admin).send(b);
    expect((await post({ ...base, loginId: 'ok.user', password: 'short' })).status).toBe(422);
    expect((await post({ ...base, loginId: '!!', password: PASSWORD })).status).toBe(422);
    expect(
      (
        await post({
          ...base,
          loginId: 'ok.user',
          password: PASSWORD,
          rights: { modules: [], items: { X: ['fly'] } },
        })
      ).status,
    ).toBe(422);
  });
});
