import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario } from '../fakes/scenario.js';
import { buildTestApp, loginAs } from '../fakes/build-test-app.js';

const bearer = async (
  app: ReturnType<typeof buildTestApp>,
  user: { loginId: string; password: string },
) => {
  const login = await loginAs(app, user.loginId, user.password);
  return { Authorization: `Bearer ${login.body.accessToken as string}` };
};

describe('voucher routes and POS extras over HTTP', () => {
  it('requires authentication', async () => {
    const app = buildTestApp(await buildScenario());
    expect((await request(app).post('/api/vouchers').send({})).status).toBe(401);
    expect((await request(app).get('/api/vouchers/ABC')).status).toBe(401);
  });

  it('issue, look up, sell with it, and see it used; a bad amount is refused', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const mgr = await bearer(app, s.tenantAManager);
    const bad = await request(app)
      .post('/api/vouchers')
      .set(mgr)
      .send({ kind: 'DISCOUNT', amount: '0' });
    expect(bad.status).toBe(422);
    const issued = await request(app)
      .post('/api/vouchers')
      .set(mgr)
      .send({ kind: 'DISCOUNT', amount: '100.00', code: 'sale-100' });
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({ code: 'SALE-100', balance: '100.00', status: 'ACTIVE' });

    const look = await request(app).get('/api/vouchers/sale-100').set(mgr);
    expect(look.status).toBe(200);
    expect(look.body.kind).toBe('DISCOUNT');

    const sold = await request(app)
      .post('/api/sales')
      .set(mgr)
      .send({
        clientRequestId: `http-voucher-${Math.random().toString(36).slice(2, 10)}`,
        storeId: s.tenantA.storeId,
        items: [{ productId: s.catalog.productId, quantity: '1' }], // 899.00
        discountVoucherCode: 'sale-100',
        serviceFee: '1.00',
        payments: [{ method: 'CASH', amount: '800.00' }],
      });
    expect(sold.status).toBe(201);
    expect(sold.body).toMatchObject({ voucherAmount: '100.00', grandTotal: '800.00' });

    const list = await request(app).get('/api/vouchers?status=USED').set(mgr);
    expect(list.body.items.map((v: { code: string }) => v.code)).toContain('SALE-100');
  });

  it("another client's staff cannot see or spend this client's voucher", async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const a = await bearer(app, s.tenantAManager);
    await request(app)
      .post('/api/vouchers')
      .set(a)
      .send({ kind: 'CREDIT_MEMO', amount: '50.00', code: 'CM-A1' });
    const b = await bearer(app, s.tenantBClientAdmin);
    expect((await request(app).get('/api/vouchers/CM-A1').set(b)).status).toBe(404);
  });

  it('a cashier without discount.apply cannot issue vouchers', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const cashier = await bearer(app, s.tenantACashier);
    const res = await request(app)
      .post('/api/vouchers')
      .set(cashier)
      .send({ kind: 'DISCOUNT', amount: '10.00' });
    expect(res.status).toBe(403);
  });
});
