import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
  DEFAULT_EXPENSE_HEADS,
} from '@mafk/shared';
import type { Prisma, PrismaClient } from '@mafk/database';
import type {
  CashActivityRecord,
  CashActivityValues,
  DeskBill,
  DeskRange,
  DeskRefund,
  DeskShop,
  DeskUserSerial,
  SaleDeskRepository,
  UpdateTenderRecord,
} from '../../domain/sale-desk.js';
import {
  DomainError,
  type SaleStatus,
  type TenderMethod,
  type TransactionalAudit,
} from '../../domain/types.js';
import { customerBalance } from './customer-repositories.js';
import { auditMeta } from './audit-meta.js';

const m2 = (d: Prisma.Decimal | null | undefined): string => (d ? d.toFixed(2) : '0.00');

const BILL_INCLUDE = {
  items: { orderBy: { id: 'asc' as const } },
  payments: { orderBy: { createdAt: 'asc' as const } },
  store: { select: { name: true, region: true } },
  _count: { select: { returns: true } },
} satisfies Prisma.SaleInclude;
type BillRow = Prisma.SaleGetPayload<{ include: typeof BILL_INCLUDE }>;

const toBill = (r: BillRow): DeskBill => ({
  id: r.id,
  invoiceNo: r.invoiceNo,
  storeId: r.storeId,
  storeName: r.store.name,
  storeRegion: r.store.region,
  soldAt: r.soldAt,
  cashierId: r.cashierId,
  customerId: r.customerId,
  customerName: r.customerNameSnapshot,
  status: r.status as SaleStatus,
  subtotal: m2(r.subtotal),
  itemDiscountTotal: m2(r.itemDiscountTotal),
  cartDiscountAmount: m2(r.cartDiscountAmount),
  taxTotal: m2(r.taxTotal),
  serviceFee: m2(r.serviceFee),
  otherCharges: m2(r.otherCharges),
  roundingAmount: m2(r.roundingAmount),
  voucherAmount: m2(r.voucherAmount),
  grandTotal: m2(r.grandTotal),
  changeDue: m2(r.changeDue),
  fbrInvoiceNo: r.fbrInvoiceNo,
  orderRef: r.orderRef,
  returnCount: r._count.returns,
  payments: r.payments.map((p) => ({
    method: p.method as TenderMethod,
    amount: m2(p.amount),
    reference: p.reference,
  })),
  items: r.items.map((i) => ({
    productName: i.productName,
    sku: i.sku,
    quantity: i.quantity.toFixed(3),
    returnedQuantity: i.returnedQuantity.toFixed(3),
    lineTotal: m2(i.lineTotal),
    discountAmount: m2(i.discountAmount),
    taxAmount: m2(i.taxAmount),
    salesman: i.salesman,
  })),
});

const toActivity = (r: Prisma.CashActivityGetPayload<object>): CashActivityRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  storeId: r.storeId,
  businessDate: r.businessDate,
  openingPettyCash: m2(r.openingPettyCash),
  receivePettyCash: m2(r.receivePettyCash),
  totalExpense: m2(r.totalExpense),
  closingPettyCash: m2(r.closingPettyCash),
  creditCardSales: m2(r.creditCardSales),
  onAccountSales: m2(r.onAccountSales),
  cashSales: m2(r.cashSales),
  redemptionAmount: m2(r.redemptionAmount),
  totalSales: m2(r.totalSales),
  openingCash: m2(r.openingCash),
  adjustment: m2(r.adjustment),
  totalAvailable: m2(r.totalAvailable),
  depositedCash: m2(r.depositedCash),
  netAvailable: m2(r.netAvailable),
  expenseLines: r.expenseLines as CashActivityRecord['expenseLines'],
  receiptLines: r.receiptLines as CashActivityRecord['receiptLines'],
  transferLines: r.transferLines as CashActivityRecord['transferLines'],
  terminalLines: r.terminalLines as CashActivityRecord['terminalLines'],
  voucherNo: r.voucherNo,
  closed: r.closed,
  closedAt: r.closedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const distinctSorted = (values: (string | null | undefined)[]): string[] =>
  [...new Set(values.map((v) => (v ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

const toSerial = (u: {
  id: string;
  loginId: string;
  displayName: string;
  status: string;
  pcSerial: string | null;
  role: { systemRole: string };
}): DeskUserSerial => ({
  id: u.id,
  loginId: u.loginId,
  displayName: u.displayName,
  systemRole: u.role.systemRole,
  status: u.status as 'ACTIVE' | 'DISABLED',
  pcSerial: u.pcSerial,
});

export class PrismaSaleDeskRepository implements SaleDeskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listShops(tenantId: string): Promise<DeskShop[]> {
    const rows = await this.prisma.store.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, region: r.region }));
  }

  async setShopRegion(tenantId: string, storeId: string, region: string | null) {
    const res = await this.prisma.store.updateMany({
      where: { id: storeId, tenantId },
      data: { region },
    });
    if (res.count === 0) return null;
    const r = await this.prisma.store.findFirstOrThrow({ where: { id: storeId, tenantId } });
    return { id: r.id, code: r.code, name: r.name, region: r.region };
  }

  async listSalesmen(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.saleItem.findMany({
      where: { tenantId, salesman: { not: null } },
      distinct: ['salesman'],
      select: { salesman: true },
      take: 500,
    });
    return distinctSorted(rows.map((r) => r.salesman));
  }

  async listTerminals(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.payment.findMany({
      where: { tenantId, method: 'CARD', reference: { contains: 'T:' } },
      orderBy: { createdAt: 'desc' },
      select: { reference: true },
      take: 2000,
    });
    const found = rows
      .map((r) => /(?:^|\s)T:(\S+)/.exec(r.reference ?? '')?.[1])
      .filter((v): v is string => !!v);
    const activities = await this.prisma.cashActivity.findMany({
      where: { tenantId },
      orderBy: { businessDate: 'desc' },
      select: { terminalLines: true },
      take: 60,
    });
    for (const a of activities) {
      for (const l of a.terminalLines as { terminal?: string }[]) found.push(l.terminal ?? '');
    }
    return distinctSorted(found);
  }

  async listExpenseHeads(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.expense.findMany({
      where: { tenantId },
      distinct: ['category'],
      select: { category: true },
      take: 200,
    });
    return distinctSorted([...DEFAULT_EXPENSE_HEADS, ...rows.map((r) => r.category)]);
  }

  private billWhere(tenantId: string, range: DeskRange): Prisma.SaleWhereInput {
    return {
      tenantId,
      status: { not: 'VOID' },
      soldAt: { gte: range.start, lt: range.end },
      ...(range.storeId ? { storeId: range.storeId } : {}),
      ...(range.region ? { store: { region: range.region } } : {}),
    };
  }

  async listBills(tenantId: string, range: DeskRange): Promise<DeskBill[]> {
    const rows = await this.prisma.sale.findMany({
      where: this.billWhere(tenantId, range),
      include: BILL_INCLUDE,
      orderBy: [{ soldAt: 'asc' }, { invoiceNo: 'asc' }],
    });
    return rows.map(toBill);
  }

  async findBill(tenantId: string, saleId: string): Promise<DeskBill | null> {
    const row = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      include: BILL_INCLUDE,
    });
    return row ? toBill(row) : null;
  }

  async listRefunds(tenantId: string, range: DeskRange): Promise<DeskRefund[]> {
    const rows = await this.prisma.saleReturn.findMany({
      where: {
        tenantId,
        createdAt: { gte: range.start, lt: range.end },
        ...(range.storeId ? { storeId: range.storeId } : {}),
        ...(range.region ? { store: { region: range.region } } : {}),
      },
      select: { storeId: true, refundMethod: true, refundTotal: true },
    });
    return rows.map((r) => ({
      storeId: r.storeId,
      refundMethod: r.refundMethod as TenderMethod,
      refundTotal: m2(r.refundTotal),
    }));
  }

  async updateTender(input: UpdateTenderRecord): Promise<DeskBill> {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: input.saleId, tenantId: input.tenantId },
        include: { payments: true },
      });
      if (!sale) throw new DomainError('NOT_FOUND', 'Bill not found.', 404);
      const before = sale.payments.map((p) => `${p.method}:${m2(p.amount)}`).join(',');

      let customerName = sale.customerNameSnapshot;
      let customerPhone = sale.customerPhoneSnapshot;
      const credit = input.payments
        .filter((p) => p.method === 'CUSTOMER_CREDIT')
        .reduce((a, p) => addDecimalStrings(a, p.amount, 2), '0.00');
      if (input.customerId) {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM customers WHERE id = ${input.customerId} AND "tenantId" = ${input.tenantId} FOR UPDATE`;
        if (locked.length !== 1)
          throw new DomainError('VALIDATION_ERROR', 'Selected customer does not exist.', 422);
        const customer = await tx.customer.findFirstOrThrow({
          where: { id: input.customerId, tenantId: input.tenantId },
        });
        customerName = customer.name;
        customerPhone = customer.phone;
        if (compareDecimalStrings(credit, '0', 2) > 0) {
          if (!customer.isActive)
            throw new DomainError('VALIDATION_ERROR', 'This customer is inactive.', 422);
          const limit = customer.creditLimit ? m2(customer.creditLimit) : '0.00';
          if (compareDecimalStrings(limit, '0', 2) <= 0) {
            throw new DomainError(
              'CREDIT_LIMIT_EXCEEDED',
              'Credit is not enabled for this customer.',
              422,
            );
          }
          // This bill's own credit is already inside the balance when the customer did not change; back it out first.
          const own =
            sale.customerId === customer.id
              ? sale.payments
                  .filter((p) => p.method === 'CUSTOMER_CREDIT')
                  .reduce((a, p) => addDecimalStrings(a, m2(p.amount), 2), '0.00')
              : '0.00';
          const balance = subtractDecimalStrings(
            await customerBalance(tx, input.tenantId, customer.id, m2(customer.openingBalance)),
            own,
            2,
          );
          const after = addDecimalStrings(balance, credit, 2);
          if (compareDecimalStrings(after, limit, 2) > 0) {
            throw new DomainError(
              'CREDIT_LIMIT_EXCEEDED',
              `Credit limit exceeded: balance ${balance} + ${credit} is over the limit of ${limit}.`,
              422,
            );
          }
        }
      } else if (compareDecimalStrings(credit, '0', 2) > 0) {
        throw new DomainError('VALIDATION_ERROR', 'An amount on account needs a customer.', 422);
      }

      await tx.payment.deleteMany({ where: { saleId: sale.id, tenantId: input.tenantId } });
      for (const p of input.payments) {
        await tx.payment.create({
          data: {
            tenantId: input.tenantId,
            saleId: sale.id,
            method: p.method,
            amount: p.amount,
            reference: p.reference,
          },
        });
      }
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          paidTotal: sale.grandTotal,
          changeDue: 0,
          fbrInvoiceNo: input.fbrInvoiceNo,
          customerId: input.customerId,
          customerNameSnapshot: input.customerId ? customerName : sale.customerNameSnapshot,
          customerPhoneSnapshot: input.customerId ? customerPhone : sale.customerPhoneSnapshot,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.audit.userId,
          action: input.audit.action,
          entity: 'Sale',
          entityId: sale.id,
          metadata: auditMeta(input.audit, {
            invoiceNo: sale.invoiceNo,
            before,
            after: input.payments.map((p) => `${p.method}:${p.amount}`).join(','),
          }),
        },
      });
      const row = await tx.sale.findFirstOrThrow({
        where: { id: sale.id, tenantId: input.tenantId },
        include: BILL_INCLUDE,
      });
      return toBill(row);
    });
  }

  async setFbrNumbers(
    tenantId: string,
    items: { saleId: string; fbrInvoiceNo: string | null }[],
    audit: TransactionalAudit,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      let n = 0;
      for (const it of items) {
        const res = await tx.sale.updateMany({
          where: { id: it.saleId, tenantId, status: { not: 'VOID' } },
          data: { fbrInvoiceNo: it.fbrInvoiceNo },
        });
        n += res.count;
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'Sale',
          metadata: auditMeta(audit, { updated: n }),
        },
      });
      return n;
    });
  }

  async findActivity(tenantId: string, storeId: string, businessDate: string) {
    const r = await this.prisma.cashActivity.findFirst({
      where: { tenantId, storeId, businessDate },
    });
    return r ? toActivity(r) : null;
  }

  async listActivities(tenantId: string, storeId: string, from: string, to: string) {
    const rows = await this.prisma.cashActivity.findMany({
      where: { tenantId, storeId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: 'asc' },
    });
    return rows.map(toActivity);
  }

  async findPreviousActivity(tenantId: string, storeId: string, businessDate: string) {
    const r = await this.prisma.cashActivity.findFirst({
      where: { tenantId, storeId, businessDate: { lt: businessDate } },
      orderBy: { businessDate: 'desc' },
    });
    return r ? toActivity(r) : null;
  }

  async hasClosedActivityAfter(tenantId: string, storeId: string, businessDate: string) {
    const n = await this.prisma.cashActivity.count({
      where: { tenantId, storeId, businessDate: { gt: businessDate }, closed: true },
    });
    return n > 0;
  }

  async saveActivity(
    tenantId: string,
    storeId: string,
    businessDate: string,
    v: CashActivityValues,
    closedById: string | null,
    audit: TransactionalAudit,
  ): Promise<CashActivityRecord> {
    return this.prisma.$transaction(async (tx) => {
      const data = {
        openingPettyCash: v.openingPettyCash,
        receivePettyCash: v.receivePettyCash,
        totalExpense: v.totalExpense,
        closingPettyCash: v.closingPettyCash,
        creditCardSales: v.creditCardSales,
        onAccountSales: v.onAccountSales,
        cashSales: v.cashSales,
        redemptionAmount: v.redemptionAmount,
        totalSales: v.totalSales,
        openingCash: v.openingCash,
        adjustment: v.adjustment,
        totalAvailable: v.totalAvailable,
        depositedCash: v.depositedCash,
        netAvailable: v.netAvailable,
        expenseLines: v.expenseLines as unknown as Prisma.InputJsonValue,
        receiptLines: v.receiptLines as unknown as Prisma.InputJsonValue,
        transferLines: v.transferLines as unknown as Prisma.InputJsonValue,
        terminalLines: v.terminalLines as unknown as Prisma.InputJsonValue,
        voucherNo: v.voucherNo,
        closed: v.closed,
        closedAt: v.closed ? new Date() : null,
        closedById: v.closed ? closedById : null,
      };
      const row = await tx.cashActivity.upsert({
        where: { tenantId_storeId_businessDate: { tenantId, storeId, businessDate } },
        create: { tenantId, storeId, businessDate, createdById: audit.userId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'CashActivity',
          entityId: row.id,
          metadata: auditMeta(audit, { storeId, businessDate, netAvailable: v.netAvailable }),
        },
      });
      return toActivity(row);
    });
  }

  async listUserSerials(tenantId: string): Promise<DeskUserSerial[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId, deletedAt: null },
      include: { role: { select: { systemRole: true } } },
      orderBy: { loginId: 'asc' },
    });
    return rows.map(toSerial);
  }

  async setUserSerial(
    tenantId: string,
    userId: string,
    serial: string | null,
    audit: TransactionalAudit,
  ): Promise<DeskUserSerial | null> {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.user.updateMany({
        where: { id: userId, tenantId, deletedAt: null },
        data: { pcSerial: serial },
      });
      if (res.count === 0) return null;
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: audit.userId,
          action: audit.action,
          entity: 'User',
          entityId: userId,
          metadata: auditMeta(audit, { pcSerial: serial }),
        },
      });
      const u = await tx.user.findFirstOrThrow({
        where: { id: userId, tenantId },
        include: { role: { select: { systemRole: true } } },
      });
      return toSerial(u);
    });
  }

  async customersLite(tenantId: string) {
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true },
      take: 1000,
    });
    return rows;
  }
}
