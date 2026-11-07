import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

const PASSWORD = 'Str0ng-Pass-9';
const STAFF_PER_BRAND = 7;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const token = async (app: Express, loginId: string, password: string): Promise<string> => {
  const res = await loginAs(app, loginId, password);
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
};

describe('Client (brand) sign-in', () => {
  it('returns the client the account belongs to', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const res = await request(app).post('/api/auth/login').send({
      loginId: s.tenantAClientAdmin.loginId,
      password: s.tenantAClientAdmin.password,
      clientCode: s.tenantA.code,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.client).toEqual({ code: 'TEN-A', name: 'Tenant A Store' });
    const me = await request(app).get('/api/auth/me').set(bearer(res.body.accessToken));
    expect(me.body.user.client.code).toBe('TEN-A');
  });

  it('accepts the client code in any letter case and still works without one', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const lower = await request(app).post('/api/auth/login').send({
      loginId: s.tenantAClientAdmin.loginId,
      password: s.tenantAClientAdmin.password,
      clientCode: ' ten-a ',
    });
    expect(lower.status).toBe(200);
    const none = await loginAs(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password);
    expect(none.status).toBe(200);
  });

  it('refuses a correct password under another client, with the same answer as a wrong password', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const wrongClient = await request(app).post('/api/auth/login').send({
      loginId: s.tenantAClientAdmin.loginId,
      password: s.tenantAClientAdmin.password,
      clientCode: s.tenantB.code,
    });
    const wrongPassword = await request(app).post('/api/auth/login').send({
      loginId: s.tenantAClientAdmin.loginId,
      password: 'Wrong-Password-1',
      clientCode: s.tenantA.code,
    });
    expect(wrongClient.status).toBe(401);
    expect(wrongClient.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongClient.body.error).toEqual(wrongPassword.body.error);
    expect(wrongClient.headers['set-cookie']).toBeUndefined();
  });

  it('refuses the platform Master Admin under a client code, and an unknown client', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    for (const clientCode of [s.tenantA.code, 'NO-SUCH']) {
      const res = await request(app).post('/api/auth/login').send({
        loginId: s.masterAdmin.loginId,
        password: s.masterAdmin.password,
        clientCode,
      });
      expect(res.status).toBe(401);
    }
    const ok = await loginAs(app, s.masterAdmin.loginId, s.masterAdmin.password);
    expect(ok.body.user.client).toBeNull();
  });
});

describe('Two brands with many staff each - complete isolation', () => {
  it('every employee of one brand sees only that brand’s data, and cannot touch the other’s', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const adminA = bearer(
      await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password),
    );
    const adminB = bearer(
      await token(app, s.tenantBClientAdmin.loginId, s.tenantBClientAdmin.password),
    );

    // Several staff per brand (the test license allows 10 users, and each brand already has some), each allowed to view customers and categories only.
    const rights = {
      modules: ['CUSTOMER', 'MASTER'],
      items: { CUSTOMERS: ['access'], CATEGORIES: ['access'] },
    };
    const staff: { brand: 'A' | 'B'; loginId: string }[] = [];
    for (const [brand, admin] of [
      ['A', adminA],
      ['B', adminB],
    ] as const) {
      for (let i = 1; i <= STAFF_PER_BRAND; i += 1) {
        const loginId = `staff.${brand.toLowerCase()}${i}`;
        const made = await request(app)
          .post('/api/admin/users')
          .set(admin)
          .send({ loginId, displayName: `Staff ${brand}${i}`, password: PASSWORD, rights });
        expect(made.status, JSON.stringify(made.body)).toBe(201);
        staff.push({ brand, loginId });
      }
    }

    // Each brand owns its own data.
    const a = {
      customer: await request(app).post('/api/customers').set(adminA).send({ name: 'A Customer' }),
      category: await request(app)
        .post('/api/catalog/categories')
        .set(adminA)
        .send({ name: 'A Category' }),
    };
    const b = {
      customer: await request(app).post('/api/customers').set(adminB).send({ name: 'B Customer' }),
      category: await request(app)
        .post('/api/catalog/categories')
        .set(adminB)
        .send({ name: 'B Category' }),
    };
    for (const r of [...Object.values(a), ...Object.values(b)]) expect(r.status).toBe(201);

    const names = (body: unknown): string[] => {
      const rows = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
      return rows.map((r) => (r as { name: string }).name);
    };

    for (const member of staff) {
      const own = member.brand;
      const t = bearer(await token(app, member.loginId, PASSWORD));
      const customers = names((await request(app).get('/api/customers').set(t)).body);
      const categories = names((await request(app).get('/api/catalog/categories').set(t)).body);
      expect(customers).toContain(`${own} Customer`);
      expect(categories).toContain(`${own} Category`);
      expect(customers.join()).not.toContain(own === 'A' ? 'B Customer' : 'A Customer');
      expect(categories.join()).not.toContain(own === 'A' ? 'B Category' : 'A Category');
    }

    // Another brand's records cannot be read, changed or deleted by id - even by that brand's own administrator.
    const aCustomer = a.customer.body.id as string;
    const aCategory = a.category.body.id as string;
    expect((await request(app).get(`/api/customers/${aCustomer}`).set(adminB)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/customers/${aCustomer}`).set(adminB).send({ name: 'Hacked' }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/catalog/categories/${aCategory}`)
          .set(adminB)
          .send({ description: 'Hacked' })
      ).status,
    ).toBe(404);
    const stillA = await request(app).get(`/api/customers/${aCustomer}`).set(adminA);
    expect(stillA.body.name).toBe('A Customer');

    // A brand cannot attach its data to another brand's records.
    const crossRef = await request(app)
      .post('/api/catalog/sub-departments')
      .set(adminB)
      .send({ name: 'Sneaky', categoryId: aCategory });
    expect(crossRef.status).toBeGreaterThanOrEqual(400);
    expect(crossRef.status).toBeLessThan(500);

    // A's staff cannot reach B's Security File users either.
    const usersA = (await request(app).get('/api/admin/users').set(adminA)).body as {
      loginId: string;
    }[];
    expect(usersA.some((u) => u.loginId.startsWith('staff.b'))).toBe(false);
    expect(usersA.filter((u) => u.loginId.startsWith('staff.a'))).toHaveLength(STAFF_PER_BRAND);
  }, 120_000);

  it('a Login ID that belongs to another brand cannot be fetched or edited through the Security File', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const adminA = bearer(
      await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password),
    );
    const adminB = bearer(
      await token(app, s.tenantBClientAdmin.loginId, s.tenantBClientAdmin.password),
    );
    const made = await request(app)
      .post('/api/admin/users')
      .set(adminB)
      .send({
        loginId: 'b.only',
        displayName: 'B Only',
        password: PASSWORD,
        rights: { modules: [], items: {} },
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    expect((await request(app).get(`/api/admin/users/${id}`).set(adminA)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/admin/users/${id}`).set(adminA).send({ status: 'DISABLED' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/admin/users/${id}`).set(adminA)).status).toBe(404);
  });
});
