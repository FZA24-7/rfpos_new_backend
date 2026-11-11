/**
 * REAL PostgreSQL test of the Sale-menu data layer (Daily Cash Activity, reports, tender update, FBR numbers, PC serial)
 * through the Prisma adapters. Needs TEST_DATABASE_URL (isolated, migrated, name contains "test"); otherwise skipped.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('Sale menu [real PostgreSQL]', () => {
    it.skip('SKIPPED: TEST_DATABASE_URL is not set (NOT VERIFIED)', () => undefined);
  });
} else {
  if (!/test/i.test(new URL(url).pathname))
    throw new Error('Refusing to run on a database without "test" in its name.');
  const { createPrismaClient } = await import('@mafk/database');
  const { createPrismaRepositories } =
    await import('../../src/infra/prisma/repositories-factory.js');
  const { SaleDeskService } = await import('../../src/services/sale-desk.service.js');
  const { customerBalance } = await import('../../src/infra/prisma/customer-repositories.js');
  const prisma = createPrismaClient({ databaseUrl: url });

  describe('Sale menu [real PostgreSQL]', () => {
    it('sheet maths, reports, tender update (with credit), FBR and PC serial against real tables', async () => {
      const run = randomUUID().slice(0, 8);
      const tenant = await prisma.tenant.create({
        data: { code: `SD${run}`, name: `Desk ${run}` },
      });
      const other = await prisma.tenant.create({
        data: { code: `SE${run}`, name: `Other ${run}` },
      });
      const store = await prisma.store.create({
        data: { tenantId: tenant.id, code: 'MAIN', name: 'Main', isDefault: true, region: 'South' },
      });
      const cat = await prisma.category.create({ data: { tenantId: tenant.id, name: 'C' } });
      const sub = await prisma.subDepartment.create({
        data: { tenantId: tenant.id, categoryId: cat.id, name: 'S' },
      });
      const product = await prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: 'Shirt',
          sku: `SH-${run}`,
          categoryId: cat.id,
          subDepartmentId: sub.id,
          costPrice: '10',
          sellingPrice: '100',
          taxRate: '0',
        },
      });
      const role = await prisma.role.create({
        data: { tenantId: tenant.id, key: 'cashier', name: 'Cashier', systemRole: 'CASHIER' },
      });
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          roleId: role.id,
          loginId: `cash.${run}`,
          displayName: 'Cashier One',
          passwordHash: 'x',
        },
      });
      const customer = await prisma.customer.create({
        data: { tenantId: tenant.id, name: 'Acme', creditLimit: '500' },
      });
      const makeSale = async (
        no: string,
        method: 'CASH' | 'CARD',
        amount: string,
        salesman: string,
      ) => {
        const sale = await prisma.sale.create({
          data: {
            tenantId: tenant.id,
            storeId: store.id,
            invoiceNo: no,
            cashierId: user.id,
            subtotal: '100',
            grandTotal: '100',
            paidTotal: amount,
            changeDue: method === 'CASH' ? '20' : '0',
          },
        });
        await prisma.saleItem.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            productId: product.id,
            productName: 'Shirt',
            sku: product.sku,
            quantity: '1',
            unitPrice: '100',
            unitCost: '10',
            lineTotal: '100',
            salesman,
          },
        });
        await prisma.payment.create({
          data: {
            tenantId: tenant.id,
            saleId: sale.id,
            method,
            amount,
            reference: method === 'CARD' ? 'A:1 T:T1' : null,
          },
        });
        return sale;
      };
      const s1 = await makeSale(`INV-${run}-1`, 'CASH', '120', 'Ali');
      const s2 = await makeSale(`INV-${run}-2`, 'CARD', '100', 'Sara');

      const svc = new SaleDeskService(createPrismaRepositories(prisma));
      const actor = {
        id: user.id,
        tenantId: tenant.id,
        permissions: ['cash_activity.create', 'cash_activity.edit'],
      };
      const lk = await svc.lookups(actor);
      expect(lk.shops[0]).toMatchObject({ code: 'MAIN', region: 'South' });
      expect(lk.regions).toEqual(['South']);
      expect(lk.salesmen).toEqual(['Ali', 'Sara']);
      expect(lk.terminals).toEqual(['T1']);

      const view = await svc.cashActivity(actor, { storeId: store.id, date: lk.today });
      expect(view).toMatchObject({
        cashSales: '100.00',
        creditCardSales: '100.00',
        totalSales: '200.00',
      });
      const saved = await svc.saveCashActivity(actor, {
        storeId: store.id,
        date: lk.today,
        receivePettyCash: '50',
        expenseLines: [{ head: 'Petty Expense', description: '', amount: '20' }],
        receiptLines: [],
        transferLines: [{ type: 'Bank Deposit', remarks: '', amount: '30' }],
        terminalLines: [],
        close: true,
      });
      expect(saved).toMatchObject({
        closingPettyCash: '30.00',
        netAvailable: '70.00',
        closed: true,
      });
      await expect(
        svc.updateTender(actor, s2.id, {
          cash: '100',
          card: '0',
          onAccount: '0',
          terminal: '',
          fbrInvoiceNo: '',
        }),
      ).rejects.toMatchObject({ code: 'BILL_LOCKED' });
      await svc.clearClosing({ ...actor, permissions: [] }, { storeId: store.id, date: lk.today });

      // re-split the card bill: 40 cash + 60 on account for Acme (limit 500)
      const out = await svc.updateTender(actor, s2.id, {
        cash: '40',
        card: '0',
        onAccount: '60',
        customerId: customer.id,
        terminal: '',
        fbrInvoiceNo: 'FBR-9',
      });
      expect(out).toMatchObject({
        cash: '40.00',
        onAccount: '60.00',
        customerName: 'Acme',
        fbrInvoiceNo: 'FBR-9',
      });
      expect(await customerBalance(prisma, tenant.id, customer.id, '0.00')).toBe('60.00');
      // the limit is enforced
      await expect(
        svc.updateTender(actor, s2.id, {
          cash: '0',
          card: '0',
          onAccount: '100',
          customerId: customer.id,
          terminal: '',
          fbrInvoiceNo: '',
        }),
      ).resolves.toBeTruthy();
      await prisma.customer.update({ where: { id: customer.id }, data: { creditLimit: '50' } });
      await expect(
        svc.updateTender(actor, s2.id, {
          cash: '0',
          card: '0',
          onAccount: '100',
          customerId: customer.id,
          terminal: '',
          fbrInvoiceNo: '',
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED' });

      const rep = await svc.dailyClosing(actor, {
        from: lk.today,
        to: lk.today,
        type: 'summary',
        format: 'json',
      });
      expect(rep.table.rows[0]).toMatchObject({ bills: 2, total: '200.00' });
      const sp = await svc.salesPerson(actor, {
        from: lk.today,
        to: lk.today,
        type: 'consolidated-summary',
        format: 'json',
      });
      expect(sp.table.rows.map((r) => r.salesman)).toEqual(['Ali', 'Sara']);
      const fbr = await svc.fbrList(actor, {
        from: lk.today,
        to: lk.today,
        status: 'pending',
        format: 'json',
      });
      expect(fbr.items).toHaveLength(2); // the second tender update cleared FBR-9
      expect(
        (await svc.fbrRepost(actor, { items: [{ saleId: s1.id, fbrInvoiceNo: 'F-1' }] })).updated,
      ).toBe(1);

      const bound = await svc.setSerial({ ...actor, id: 'someone-else' }, user.id, {
        serial: ' pc-77 ',
      });
      expect(bound.pcSerial).toBe('PC-77');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pcSerial).toBe(
        'PC-77',
      );
      await expect(
        svc.setSerial({ ...actor, id: 'x', tenantId: other.id }, user.id, { serial: 'X' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
}
