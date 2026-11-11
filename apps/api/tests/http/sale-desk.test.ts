import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildScenario, type Scenario } from '../fakes/scenario.js';
import { buildTestApp } from '../fakes/build-test-app.js';
import { addDaysToYmd } from '@mafk/shared';

type App = ReturnType<typeof buildTestApp>;
const bearer = async (app: App, user: { loginId: string; password: string }, serial?: string) => {
  const req = request(app)
    .post('/api/auth/login')
    .send({ loginId: user.loginId, password: user.password });
  const login = serial ? await req.set('x-mafk-pc-serial', serial) : await req;
  return { Authorization: `Bearer ${login.body.accessToken as string}` };
};

let n = 0;
const sell = (
  app: App,
  s: Scenario,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) =>
  request(app)
    .post('/api/sales')
    .set(headers)
    .send({
      clientRequestId: `desk-${++n}-${Math.random().toString(36).slice(2, 8)}`,
      storeId: s.tenantA.storeId,
      ...body,
    });

const seedDay = async () => {
  const s = await buildScenario();
  const app = buildTestApp(s);
  const admin = await bearer(app, s.tenantAClientAdmin);
  const item = (salesman: string) => [{ productId: s.catalog.productId, quantity: '1', salesman }]; // 899.00
  const a = await sell(app, s, admin, {
    items: item('Ali'),
    payments: [{ method: 'CASH', amount: '1000.00' }],
  });
  const b = await sell(app, s, admin, {
    items: item('Sara'),
    payments: [{ method: 'CARD', amount: '899.00', reference: '4111 A:77 T:T1' }],
  });
  await request(app)
    .post('/api/vouchers')
    .set(admin)
    .send({ kind: 'DISCOUNT', amount: '100.00', code: 'dv100' });
  const c = await sell(app, s, admin, {
    items: item('Ali'),
    discountVoucherCode: 'dv100',
    serviceFee: '1.00',
    payments: [{ method: 'CASH', amount: '800.00' }],
  });
  expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
  const lk = await request(app).get('/api/sale-desk/lookups').set(admin);
  return {
    s,
    app,
    admin,
    today: lk.body.today as string,
    saleIds: [a.body.id, b.body.id, c.body.id] as string[],
  };
};

describe('Sale menu API', () => {
  it('needs a login and the right permission', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    expect((await request(app).get('/api/sale-desk/lookups')).status).toBe(401);
    const mgr = await bearer(app, s.tenantAManager);
    const q = `storeId=${s.tenantA.storeId}&date=2026-01-01`;
    expect((await request(app).get(`/api/sale-desk/cash-activity?${q}`).set(mgr)).status).toBe(403);
    expect((await request(app).get('/api/sale-desk/pc-serials').set(mgr)).status).toBe(403);
    const master = await bearer(app, s.masterAdmin);
    expect((await request(app).get('/api/sale-desk/lookups').set(master)).status).toBe(403);
  });

  it("another client's shop is refused", async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const bAdmin = await bearer(app, s.tenantBClientAdmin);
    const r = await request(app)
      .get(`/api/sale-desk/cash-activity?storeId=${s.tenantA.storeId}&date=2026-01-01`)
      .set(bAdmin);
    expect(r.status).toBe(422);
  });

  it('Daily Cash Activity: figures come from the bills, the sheet closes, locks and re-opens', async () => {
    const { s, app, admin, today } = await seedDay();
    const view = await request(app)
      .get(`/api/sale-desk/cash-activity?storeId=${s.tenantA.storeId}&date=${today}`)
      .set(admin);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      cashSales: '1699.00', // 899 (1000 tendered, 101 change) + 800
      creditCardSales: '899.00',
      onAccountSales: '0.00',
      redemptionAmount: '100.00',
      totalSales: '2698.00',
      closed: false,
      saved: false,
    });

    // yesterday has petty cash left over -> it becomes today's opening petty cash
    const yesterday = addDaysToYmd(today, -1);
    const y = await request(app)
      .put('/api/sale-desk/cash-activity')
      .set(admin)
      .send({
        storeId: s.tenantA.storeId,
        date: yesterday,
        receivePettyCash: '100',
        expenseLines: [{ head: 'Petty Expense', amount: '40' }],
      });
    expect(y.status).toBe(200);
    expect(y.body).toMatchObject({ closingPettyCash: '60.00', netAvailable: '0.00' });

    const body = {
      storeId: s.tenantA.storeId,
      date: today,
      receivePettyCash: '500',
      expenseLines: [{ head: 'Conveyance', description: 'Rickshaw', amount: '200' }],
      receiptLines: [{ head: 'Scrap Sale', amount: '50' }],
      transferLines: [{ type: 'Bank Deposit', remarks: 'HBL', amount: '1000' }],
      terminalLines: [{ terminal: 'T1', gtech: '899', settlement: '899', batch: '12' }],
    };
    const saved = await request(app).put('/api/sale-desk/cash-activity').set(admin).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      openingPettyCash: '60.00',
      totalExpense: '200.00',
      closingPettyCash: '360.00',
      adjustment: '50.00',
      totalAvailable: '1749.00',
      depositedCash: '1000.00',
      netAvailable: '749.00',
      closed: false,
      voucherNo: null,
    });

    // deposits above the cash on hand are refused and nothing changes
    const tooMuch = await request(app)
      .put('/api/sale-desk/cash-activity')
      .set(admin)
      .send({ ...body, transferLines: [{ type: 'Bank Deposit', amount: '5000' }] });
    expect(tooMuch.status).toBe(422);
    const future = await request(app)
      .put('/api/sale-desk/cash-activity')
      .set(admin)
      .send({ ...body, date: addDaysToYmd(today, 3) });
    expect(future.status).toBe(422);

    const closed = await request(app)
      .put('/api/sale-desk/cash-activity')
      .set(admin)
      .send({ ...body, close: true });
    expect(closed.body.closed).toBe(true);
    expect(closed.body.voucherNo).toMatch(/^CV-.+-\d{8}$/);
    expect(
      (await request(app).put('/api/sale-desk/cash-activity').set(admin).send(body)).status,
    ).toBe(409);

    // the closed day cannot be unlocked while a later day is closed, and the earlier day stays untouched
    const list = await request(app)
      .get(
        `/api/sale-desk/cash-activity/list?storeId=${s.tenantA.storeId}&from=${yesterday}&to=${today}`,
      )
      .set(admin);
    expect(list.body.items.map((i: { date: string }) => i.date)).toEqual([yesterday, today]);

    const reopened = await request(app)
      .post('/api/sale-desk/cash-activity/clear-closing')
      .set(admin)
      .send({ storeId: s.tenantA.storeId, date: today });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ closed: false, voucherNo: null });

    const repost = await request(app)
      .post('/api/sale-desk/cash-activity/repost')
      .set(admin)
      .send({ storeId: s.tenantA.storeId, from: yesterday, to: today });
    expect(repost.body).toMatchObject({ updated: 2, skippedClosed: 0 });
  });

  it('reports: daily sales, bill wise and the five sales-person types add up', async () => {
    const { s, app, admin, today } = await seedDay();
    const q = `from=${today}&to=${today}&storeId=${s.tenantA.storeId}`;
    const daily = await request(app)
      .get(`/api/sale-desk/reports/daily-closing?${q}&type=summary`)
      .set(admin);
    expect(daily.status).toBe(200);
    expect(daily.body.table.rows).toHaveLength(1);
    expect(daily.body.table.rows[0]).toMatchObject({
      bills: 3,
      cash: '1699.00',
      card: '899.00',
      redemption: '100.00',
      total: '2598.00',
    });
    // 899 + 899 + (899 + 1 - 100) = 2598 ; the 100 voucher is paid by the voucher, not by tender

    const detail = await request(app)
      .get(`/api/sale-desk/reports/daily-closing?${q}&type=detail`)
      .set(admin);
    expect(detail.body.table.rows).toHaveLength(3);
    const onlyAli = await request(app)
      .get(`/api/sale-desk/reports/daily-closing?${q}&type=summary&salesman=Ali`)
      .set(admin);
    expect(onlyAli.body.table.rows[0]).toMatchObject({ bills: 2, sales: '1798.00' });

    const csv = await request(app)
      .get(`/api/sale-desk/reports/daily-closing?${q}&type=summary&format=csv`)
      .set(admin);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.startsWith('﻿')).toBe(true);
    expect(csv.text).toContain('Daily Sales Report');

    const bill = await request(app)
      .get(`/api/sale-desk/reports/bill-wise?from=${today}&to=${today}&type=summary`)
      .set(admin);
    expect(bill.body.table.rows).toHaveLength(3);
    const billDetail = await request(app)
      .get(`/api/sale-desk/reports/bill-wise?from=${today}&to=${today}&type=detail`)
      .set(admin);
    expect(billDetail.body.table.rows).toHaveLength(3);
    const noRegion = await request(app)
      .get(`/api/sale-desk/reports/bill-wise?from=${today}&to=${today}&region=North`)
      .set(admin);
    expect(noRegion.body.table.rows).toHaveLength(0);
    const setRegion = await request(app)
      .put(`/api/sale-desk/shops/${s.tenantA.storeId}/region`)
      .set(admin)
      .send({ region: 'North' });
    expect(setRegion.body.region).toBe('North');
    const withRegion = await request(app)
      .get(`/api/sale-desk/reports/bill-wise?from=${today}&to=${today}&region=North`)
      .set(admin);
    expect(withRegion.body.table.rows).toHaveLength(3);

    const sp = async (type: string) =>
      (await request(app).get(`/api/sale-desk/reports/sales-person?${q}&type=${type}`).set(admin))
        .body.table;
    const day = await sp('day-wise');
    expect(day.rows).toHaveLength(2);
    expect(day.columns.map((c: { key: string }) => c.key)).toContain('date');
    const cons = await sp('consolidated');
    expect(cons.rows.map((r: { salesman: string }) => r.salesman)).toEqual(['Ali', 'Sara']);
    const shop = await sp('shop-wise');
    expect(shop.rows).toHaveLength(2);
    const cashier = await sp('cashier-wise');
    expect(cashier.rows).toHaveLength(2);
    const sum = await sp('consolidated-summary');
    expect(sum.rows[0]).toMatchObject({
      salesman: 'Ali',
      bills: 2,
      net: '1798.00',
      share: '66.7',
      avg: '899.00',
    });
    expect(sum.rows[1]).toMatchObject({ salesman: 'Sara', bills: 1, share: '33.3' });
    expect(sum.totals).toMatchObject({ bills: 3, net: '2697.00', share: '100.0' });

    expect(
      (await request(app).get(`/api/sale-desk/reports/sales-person?${q}&type=bogus`).set(admin))
        .status,
    ).toBe(422);
  });

  it('Cash and Credit Card Update: re-splits a bill, keeps the total, and is locked by a closed day', async () => {
    const { s, app, admin, today, saleIds } = await seedDay();
    const cardBill = saleIds[1]!;
    const list = await request(app)
      .get(`/api/sale-desk/bills?storeId=${s.tenantA.storeId}&date=${today}`)
      .set(admin);
    expect(list.body.items).toHaveLength(3);

    const before = await request(app).get(`/api/sale-desk/bills/${cardBill}/tender`).set(admin);
    expect(before.body).toMatchObject({
      netReceivable: '899.00',
      cash: '0.00',
      card: '899.00',
      terminal: 'T1',
      lockedReason: null,
    });

    const wrong = await request(app)
      .put(`/api/sale-desk/bills/${cardBill}/tender`)
      .set(admin)
      .send({ cash: '100', card: '100' });
    expect(wrong.status).toBe(422);

    const ok = await request(app)
      .put(`/api/sale-desk/bills/${cardBill}/tender`)
      .set(admin)
      .send({ cash: '400', card: '499', terminal: 'T9', fbrInvoiceNo: 'FBR-1' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      cash: '400.00',
      card: '499.00',
      terminal: 'T9',
      fbrInvoiceNo: 'FBR-1',
    });
    // the card number and approval of the original swipe are kept
    const sale = await request(app).get(`/api/sales/${cardBill}`).set(admin);
    expect(sale.body.paidTotal).toBe('899.00');
    expect(sale.body.payments.find((p: { method: string }) => p.method === 'CARD').reference).toBe(
      '4111 A:77 T:T9',
    );

    // on account needs a customer
    const noCust = await request(app)
      .put(`/api/sale-desk/bills/${cardBill}/tender`)
      .set(admin)
      .send({ cash: '0', card: '0', onAccount: '899' });
    expect(noCust.status).toBe(422);

    // closed day -> locked
    await request(app)
      .put('/api/sale-desk/cash-activity')
      .set(admin)
      .send({ storeId: s.tenantA.storeId, date: today, close: true });
    const locked = await request(app)
      .put(`/api/sale-desk/bills/${cardBill}/tender`)
      .set(admin)
      .send({ cash: '899' });
    expect(locked.status).toBe(409);
    expect(
      (await request(app).get(`/api/sale-desk/bills/${cardBill}/tender`).set(admin)).body
        .lockedReason,
    ).toMatch(/closed/);
  });

  it('FBR Repost Period: lists pending bills, stores the FBR numbers, exports CSV', async () => {
    const { s, app, admin, today, saleIds } = await seedDay();
    const q = `from=${today}&to=${today}&storeId=${s.tenantA.storeId}`;
    const pending = await request(app).get(`/api/sale-desk/fbr?${q}&status=pending`).set(admin);
    expect(pending.body.items).toHaveLength(3);
    expect(pending.body.pending).toBe(3);
    const post = await request(app)
      .post('/api/sale-desk/fbr/repost')
      .set(admin)
      .send({
        items: [
          { saleId: saleIds[0], fbrInvoiceNo: 'FBR-100' },
          { saleId: saleIds[1], fbrInvoiceNo: 'FBR-101' },
        ],
      });
    expect(post.body.updated).toBe(2);
    const after = await request(app).get(`/api/sale-desk/fbr?${q}&status=pending`).set(admin);
    expect(after.body.items).toHaveLength(1);
    const posted = await request(app).get(`/api/sale-desk/fbr?${q}&status=posted`).set(admin);
    expect(posted.body.items.map((i: { fbrInvoiceNo: string }) => i.fbrInvoiceNo).sort()).toEqual([
      'FBR-100',
      'FBR-101',
    ]);
    const csv = await request(app).get(`/api/sale-desk/fbr?${q}&status=all&format=csv`).set(admin);
    expect(csv.text).toContain('FBR-100');
    // clearing a number puts the bill back to pending
    await request(app)
      .post('/api/sale-desk/fbr/repost')
      .set(admin)
      .send({ items: [{ saleId: saleIds[0], fbrInvoiceNo: '' }] });
    expect(
      (await request(app).get(`/api/sale-desk/fbr?${q}&status=pending`).set(admin)).body.items,
    ).toHaveLength(2);
  });
});

describe('User PC Serial', () => {
  it('an ID bound to a PC signs in only from that PC - cashier or admin alike', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const users = await request(app).get('/api/sale-desk/pc-serials').set(admin);
    expect(users.body.items.map((u: { loginId: string }) => u.loginId)).toContain(
      s.tenantACashier.loginId,
    );

    const bind = await request(app)
      .put(`/api/sale-desk/pc-serials/${s.tenantACashier.id}`)
      .set(admin)
      .send({ serial: ' abc-123 ' });
    expect(bind.status).toBe(200);
    expect(bind.body.pcSerial).toBe('ABC-123');

    const login = (serial?: string) => {
      const r = request(app)
        .post('/api/auth/login')
        .send({ loginId: s.tenantACashier.loginId, password: s.tenantACashier.password });
      return serial ? r.set('x-mafk-pc-serial', serial) : r;
    };
    const none = await login();
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('PC_NOT_ALLOWED');
    expect((await login('OTHER-PC')).status).toBe(403);
    const good = await login('abc-123');
    expect(good.status).toBe(200);

    // a refresh from another PC is refused too
    const cookie = (good.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0]!)
      .join('; ');
    expect(
      (
        await request(app)
          .post('/api/auth/refresh')
          .set('Cookie', cookie)
          .set('x-mafk-pc-serial', 'OTHER-PC')
      ).status,
    ).toBe(403);

    // wrong password still looks like a wrong password, not a PC problem
    const badPw = await request(app)
      .post('/api/auth/login')
      .send({ loginId: s.tenantACashier.loginId, password: 'nope-nope-nope' });
    expect(badPw.body.error.code).toBe('INVALID_CREDENTIALS');

    // "-" (or empty) removes the lock
    const unbind = await request(app)
      .put(`/api/sale-desk/pc-serials/${s.tenantACashier.id}`)
      .set(admin)
      .send({ serial: '-' });
    expect(unbind.body.pcSerial).toBeNull();
    expect((await login()).status).toBe(200);
  });

  it('refuses a change that would lock the administrator out of the PC they are on', async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const admin = await bearer(app, s.tenantAClientAdmin);
    const self = await request(app)
      .put(`/api/sale-desk/pc-serials/${s.tenantAClientAdmin.id}`)
      .set(admin)
      .send({ serial: 'SOMEWHERE-ELSE' });
    expect(self.status).toBe(422);
    // from the PC itself it is fine, and then only that PC can sign in
    const onPc = await bearer(app, s.tenantAClientAdmin, 'MY-PC');
    expect(
      (
        await request(app)
          .put(`/api/sale-desk/pc-serials/${s.tenantAClientAdmin.id}`)
          .set({ ...onPc, 'x-mafk-pc-serial': 'MY-PC' })
          .send({ serial: 'MY-PC' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ loginId: s.tenantAClientAdmin.loginId, password: s.tenantAClientAdmin.password })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('x-mafk-pc-serial', 'my-pc')
          .send({ loginId: s.tenantAClientAdmin.loginId, password: s.tenantAClientAdmin.password })
      ).status,
    ).toBe(200);
  });

  it("cannot bind another client's user", async () => {
    const s = await buildScenario();
    const app = buildTestApp(s);
    const bAdmin = await bearer(app, s.tenantBClientAdmin);
    const r = await request(app)
      .put(`/api/sale-desk/pc-serials/${s.tenantACashier.id}`)
      .set(bAdmin)
      .send({ serial: 'X' });
    expect(r.status).toBe(404);
  });
});
