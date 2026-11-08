import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

const PASSWORD = 'Str0ng-Pass-9';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const token = async (app: Express, loginId: string, password: string): Promise<string> => {
  const res = await loginAs(app, loginId, password);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
};

const setup = async () => {
  const s = await buildScenario();
  const app = buildTestApp(s);
  const master = bearer(await token(app, s.masterAdmin.loginId, s.masterAdmin.password));
  return { s, app, master, base: `/api/master/tenants/${s.tenantA.id}/user-admin` };
};

describe('Master Admin - full user management for any client', () => {
  it('creates a user for a client WITH module rights, and the user gets exactly those rights', async () => {
    const { s, app, master, base } = await setup();
    const rights = { modules: ['SALE'], items: { POS: ['access', 'add'] } };
    const made = await request(app)
      .post(`${base}/users`)
      .set(master)
      .send({ loginId: 'mtj.cashier', displayName: 'MTJ Cashier', password: PASSWORD, rights });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.rights).toEqual(rights);

    const t = bearer(await token(app, 'mtj.cashier', PASSWORD));
    const me = await request(app).get('/api/auth/me').set(t);
    expect(me.body.user.tenantId).toBe(s.tenantA.id);
    expect(me.body.user.permissions).toContain('pos.view');
    expect(me.body.user.permissions).not.toContain('products.edit');
    expect((await request(app).get('/api/customers').set(t)).status).toBe(403);
  });

  it('edits every detail of a user: name, status, password, location, rights - and the rights are visible afterwards', async () => {
    const { app, master, base } = await setup();
    const made = await request(app)
      .post(`${base}/users`)
      .set(master)
      .send({
        loginId: 'edit.me',
        displayName: 'Edit Me',
        password: PASSWORD,
        rights: { modules: [], items: {} },
      });
    const id = made.body.id as string;
    const rights = {
      modules: ['CUSTOMER', 'MASTER'],
      items: { CUSTOMERS: ['access', 'add'], CATEGORIES: ['access'] },
    };
    const upd = await request(app)
      .patch(`${base}/users/${id}`)
      .set(master)
      .send({ displayName: 'Renamed Person', password: 'An0ther-Strong-Pass', rights });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const got = await request(app).get(`${base}/users/${id}`).set(master);
    expect(got.body.displayName).toBe('Renamed Person');
    expect(got.body.rights).toEqual(rights);
    expect(got.body.rightsSource).toBe('saved');
    expect(await loginAs(app, 'edit.me', PASSWORD).then((r) => r.status)).toBe(401);
    expect(await loginAs(app, 'edit.me', 'An0ther-Strong-Pass').then((r) => r.status)).toBe(200);

    const off = await request(app)
      .patch(`${base}/users/${id}`)
      .set(master)
      .send({ status: 'DISABLED' });
    expect(off.status).toBe(200);
    expect(await loginAs(app, 'edit.me', 'An0ther-Strong-Pass').then((r) => r.status)).toBe(403);
  });

  it('can change a user’s Login ID, and the old one stops working', async () => {
    const { s, app, master, base } = await setup();
    const made = await request(app)
      .post(`${base}/users`)
      .set(master)
      .send({
        loginId: 'old.name',
        displayName: 'Rename Login',
        password: PASSWORD,
        rights: { modules: [], items: {} },
      });
    const id = made.body.id as string;
    const res = await request(app)
      .patch(`/api/users/${id}/login-id`)
      .set(master)
      .send({ newLoginId: 'new.name' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await loginAs(app, 'old.name', PASSWORD).then((r) => r.status)).toBe(401);
    expect(await loginAs(app, 'new.name', PASSWORD).then((r) => r.status)).toBe(200);
    expect(s.tenantA.id).toBeTruthy();
  });

  it('lists a client’s users and shows the owner’s rights as read-only (owner always has full access)', async () => {
    const { s, app, master, base } = await setup();
    const list = await request(app).get(`${base}/users`).set(master);
    expect(list.status).toBe(200);
    const owner = (list.body as { id: string; loginId: string }[]).find(
      (u) => u.loginId === s.tenantAClientAdmin.loginId,
    );
    expect(owner).toBeTruthy();
    const detail = await request(app).get(`${base}/users/${owner!.id}`).set(master);
    expect(detail.body.rightsEditable).toBe(false); // shown read-only...
    const restrict = await request(app)
      .patch(`${base}/users/${owner!.id}`)
      .set(master)
      .send({ rights: { modules: [], items: {} } });
    expect(restrict.status).toBe(403); // ...the owner can never be locked out
  });

  it('is limited to the named client: a user of A cannot be reached through B, and unknown clients are 404', async () => {
    const { s, app, master, base } = await setup();
    const made = await request(app)
      .post(`${base}/users`)
      .set(master)
      .send({
        loginId: 'a.only',
        displayName: 'A Only',
        password: PASSWORD,
        rights: { modules: [], items: {} },
      });
    const id = made.body.id as string;
    const viaB = `/api/master/tenants/${s.tenantB.id}/user-admin/users/${id}`;
    expect((await request(app).get(viaB).set(master)).status).toBe(404);
    expect(
      (await request(app).patch(viaB).set(master).send({ displayName: 'Hijack' })).status,
    ).toBe(404);
    expect((await request(app).delete(viaB).set(master)).status).toBe(404);
    expect(
      (await request(app).get('/api/master/tenants/nope/user-admin/users').set(master)).status,
    ).toBe(404);
  });

  it('is refused to everyone who is not the platform Master Admin', async () => {
    const { s, app, base } = await setup();
    const client = bearer(
      await token(app, s.tenantAClientAdmin.loginId, s.tenantAClientAdmin.password),
    );
    expect((await request(app).get(`${base}/users`).set(client)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base}/users`)
          .set(client)
          .send({ loginId: 'x.y', displayName: 'X Y', password: PASSWORD })
      ).status,
    ).toBe(403);
    expect((await request(app).get(`${base}/users`)).status).toBe(401);
  });

  it('the license user limit still applies', async () => {
    const { app, master, base } = await setup();
    let blocked = 0;
    for (let i = 1; i <= 12; i += 1) {
      const r = await request(app)
        .post(`${base}/users`)
        .set(master)
        .send({
          loginId: `lim.user${i}`,
          displayName: `Limit ${i}`,
          password: PASSWORD,
          rights: { modules: [], items: {} },
        });
      if (r.status === 409) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
  }, 120_000);
});
