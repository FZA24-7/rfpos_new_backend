import {
  DEFAULT_EXPENSE_HEADS,
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from '@mafk/shared';
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
} from '../../src/domain/sale-desk.js';
import { DomainError, type SaleDetail, type TransactionalAudit } from '../../src/domain/types.js';
import type { FakeSaleRepository } from './fake-sale-repository.js';
import type {
  FakeAuditLogRepository,
  FakeStoreRepository,
  FakeUserRepository,
} from './in-memory-repositories.js';
import type { FakeCustomerRepository } from './fake-phase6-repositories.js';

const clone = <T>(v: T): T => structuredClone(v);

export class FakeSaleDeskRepository implements SaleDeskRepository {
  readonly regions = new Map<string, string | null>();
  readonly activities = new Map<string, CashActivityRecord>();
  private seq = 0;

  constructor(
    private readonly sales: FakeSaleRepository,
    private readonly stores: FakeStoreRepository,
    private readonly users: FakeUserRepository,
    private readonly customers: FakeCustomerRepository,
    private readonly audit: FakeAuditLogRepository,
  ) {}

  private key = (t: string, s: string, d: string) => `${t}|${s}|${d}`;

  async listShops(tenantId: string): Promise<DeskShop[]> {
    return [...this.stores.stores.values()]
      .filter((s) => s.tenantId === tenantId && s.isActive)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        region: this.regions.get(s.id) ?? null,
      }));
  }
  async setShopRegion(tenantId: string, storeId: string, region: string | null) {
    const s = this.stores.stores.get(storeId);
    if (!s || s.tenantId !== tenantId) return null;
    this.regions.set(storeId, region);
    return { id: s.id, code: s.code, name: s.name, region };
  }
  async listSalesmen(tenantId: string): Promise<string[]> {
    const out = new Set<string>();
    for (const s of this.sales.sales.values())
      if (s.tenantId === tenantId) for (const i of s.items) if (i.salesman) out.add(i.salesman);
    return [...out].sort();
  }
  async listTerminals(tenantId: string): Promise<string[]> {
    const out = new Set<string>();
    for (const s of this.sales.sales.values()) {
      if (s.tenantId !== tenantId) continue;
      for (const p of s.payments) {
        const m = /(?:^|\s)T:(\S+)/.exec(p.reference ?? '');
        if (p.method === 'CARD' && m?.[1]) out.add(m[1]);
      }
    }
    return [...out].sort();
  }
  async listExpenseHeads(): Promise<string[]> {
    return [...DEFAULT_EXPENSE_HEADS].sort();
  }

  private toBill(s: SaleDetail): DeskBill {
    const store = this.stores.stores.get(s.storeId);
    return {
      id: s.id,
      invoiceNo: s.invoiceNo,
      storeId: s.storeId,
      storeName: store?.name ?? '',
      storeRegion: this.regions.get(s.storeId) ?? null,
      soldAt: s.soldAt,
      cashierId: s.cashierId,
      customerId: s.customerId,
      customerName: s.customerName,
      status: s.status,
      subtotal: s.subtotal,
      itemDiscountTotal: s.itemDiscountTotal,
      cartDiscountAmount: s.cartDiscountAmount,
      taxTotal: s.taxTotal,
      serviceFee: s.serviceFee,
      otherCharges: s.otherCharges,
      roundingAmount: s.roundingAmount,
      voucherAmount: s.voucherAmount,
      grandTotal: s.grandTotal,
      changeDue: s.changeDue,
      fbrInvoiceNo: s.fbrInvoiceNo,
      orderRef: s.orderRef,
      returnCount: s.returns.length,
      payments: s.payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        reference: p.reference,
      })),
      items: s.items.map((i) => ({
        productName: i.productName,
        sku: i.sku,
        quantity: i.quantity,
        returnedQuantity: i.returnedQuantity,
        lineTotal: i.lineTotal,
        discountAmount: i.discountAmount,
        taxAmount: i.taxAmount,
        salesman: i.salesman ?? null,
      })),
    };
  }

  private inRange(storeId: string, at: Date, r: DeskRange): boolean {
    if (at < r.start || at >= r.end) return false;
    if (r.storeId && storeId !== r.storeId) return false;
    if (r.region && (this.regions.get(storeId) ?? null) !== r.region) return false;
    return true;
  }

  async listBills(tenantId: string, range: DeskRange): Promise<DeskBill[]> {
    return [...this.sales.sales.values()]
      .filter(
        (s) =>
          s.tenantId === tenantId &&
          s.status !== 'VOID' &&
          this.inRange(s.storeId, s.soldAt, range),
      )
      .sort(
        (a, b) => a.soldAt.getTime() - b.soldAt.getTime() || a.invoiceNo.localeCompare(b.invoiceNo),
      )
      .map((s) => this.toBill(s));
  }
  async findBill(tenantId: string, saleId: string): Promise<DeskBill | null> {
    const s = this.sales.sales.get(saleId);
    return s && s.tenantId === tenantId ? this.toBill(s) : null;
  }
  async listRefunds(tenantId: string, range: DeskRange): Promise<DeskRefund[]> {
    const out: DeskRefund[] = [];
    for (const s of this.sales.sales.values()) {
      if (s.tenantId !== tenantId) continue;
      for (const r of s.returns)
        if (this.inRange(r.storeId, r.createdAt, range))
          out.push({
            storeId: r.storeId,
            refundMethod: r.refundMethod,
            refundTotal: r.refundTotal,
          });
    }
    return out;
  }

  async updateTender(input: UpdateTenderRecord): Promise<DeskBill> {
    const sale = this.sales.sales.get(input.saleId);
    if (!sale || sale.tenantId !== input.tenantId)
      throw new DomainError('NOT_FOUND', 'Bill not found.', 404);
    const credit = input.payments
      .filter((p) => p.method === 'CUSTOMER_CREDIT')
      .reduce((a, p) => addDecimalStrings(a, p.amount, 2), '0.00');
    let customerName = sale.customerName;
    if (input.customerId) {
      const c = this.sales.credit?.find(input.customerId, input.tenantId);
      if (!c) throw new DomainError('VALIDATION_ERROR', 'Selected customer does not exist.', 422);
      customerName = c.name;
      if (compareDecimalStrings(credit, '0', 2) > 0) {
        const limit = c.creditLimit ?? '0.00';
        if (compareDecimalStrings(limit, '0', 2) <= 0)
          throw new DomainError(
            'CREDIT_LIMIT_EXCEEDED',
            'Credit is not enabled for this customer.',
            422,
          );
        const own =
          sale.customerId === c.id
            ? sale.payments
                .filter((p) => p.method === 'CUSTOMER_CREDIT')
                .reduce((a, p) => addDecimalStrings(a, p.amount, 2), '0.00')
            : '0.00';
        const balance = subtractDecimalStrings(this.sales.credit!.balanceOf(c.id), own, 2);
        if (compareDecimalStrings(addDecimalStrings(balance, credit, 2), limit, 2) > 0)
          throw new DomainError('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded.', 422);
      }
    } else if (compareDecimalStrings(credit, '0', 2) > 0) {
      throw new DomainError('VALIDATION_ERROR', 'An amount on account needs a customer.', 422);
    }
    sale.payments = input.payments.map((p, i) => ({
      id: `pay-${++this.seq}-${i}`,
      method: p.method,
      amount: p.amount,
      reference: p.reference,
    }));
    sale.paidTotal = sale.grandTotal;
    sale.changeDue = '0.00';
    sale.fbrInvoiceNo = input.fbrInvoiceNo;
    sale.customerId = input.customerId;
    sale.customerName = input.customerId ? customerName : sale.customerName;
    this.audit.entries.push({
      id: `audit-${++this.seq}`,
      tenantId: input.tenantId,
      userId: input.audit.userId,
      action: input.audit.action,
      entity: 'Sale',
      entityId: sale.id,
      metadata: input.audit.metadata ?? null,
      createdAt: new Date(),
    } as never);
    return this.toBill(sale);
  }

  async setFbrNumbers(
    tenantId: string,
    items: { saleId: string; fbrInvoiceNo: string | null }[],
    audit: TransactionalAudit,
  ): Promise<number> {
    let n = 0;
    for (const it of items) {
      const s = this.sales.sales.get(it.saleId);
      if (s && s.tenantId === tenantId && s.status !== 'VOID') {
        s.fbrInvoiceNo = it.fbrInvoiceNo;
        n++;
      }
    }
    this.audit.entries.push({
      id: `audit-${++this.seq}`,
      tenantId,
      userId: audit.userId,
      action: audit.action,
      entity: 'Sale',
      entityId: null,
      metadata: { updated: n },
      createdAt: new Date(),
    } as never);
    return n;
  }

  async findActivity(t: string, s: string, d: string) {
    const a = this.activities.get(this.key(t, s, d));
    return a ? clone(a) : null;
  }
  async listActivities(t: string, s: string, from: string, to: string) {
    return [...this.activities.values()]
      .filter(
        (a) =>
          a.tenantId === t && a.storeId === s && a.businessDate >= from && a.businessDate <= to,
      )
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
      .map(clone);
  }
  async findPreviousActivity(t: string, s: string, d: string) {
    const prev = [...this.activities.values()]
      .filter((a) => a.tenantId === t && a.storeId === s && a.businessDate < d)
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0];
    return prev ? clone(prev) : null;
  }
  async hasClosedActivityAfter(t: string, s: string, d: string) {
    return [...this.activities.values()].some(
      (a) => a.tenantId === t && a.storeId === s && a.businessDate > d && a.closed,
    );
  }
  async saveActivity(
    t: string,
    s: string,
    d: string,
    v: CashActivityValues,
    closedById: string | null,
    audit: TransactionalAudit,
  ) {
    const key = this.key(t, s, d);
    const old = this.activities.get(key);
    const now = new Date();
    const rec: CashActivityRecord = {
      ...clone(v),
      id: old?.id ?? `ca-${++this.seq}`,
      tenantId: t,
      storeId: s,
      businessDate: d,
      closedAt: v.closed ? now : null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    void closedById;
    this.activities.set(key, rec);
    this.audit.entries.push({
      id: `audit-${++this.seq}`,
      tenantId: t,
      userId: audit.userId,
      action: audit.action,
      entity: 'CashActivity',
      entityId: rec.id,
      metadata: { storeId: s, businessDate: d },
      createdAt: now,
    } as never);
    return clone(rec);
  }

  private serialOf(u: {
    id: string;
    loginId: string;
    displayName: string;
    systemRole: string;
    status: 'ACTIVE' | 'DISABLED';
    pcSerial?: string | null;
  }): DeskUserSerial {
    return {
      id: u.id,
      loginId: u.loginId,
      displayName: u.displayName,
      systemRole: u.systemRole,
      status: u.status,
      pcSerial: u.pcSerial ?? null,
    };
  }
  async listUserSerials(tenantId: string): Promise<DeskUserSerial[]> {
    return [...this.users.users.values()]
      .filter((u) => u.tenantId === tenantId)
      .map((u) => this.serialOf(u));
  }
  async setUserSerial(
    tenantId: string,
    userId: string,
    serial: string | null,
    audit: TransactionalAudit,
  ) {
    const u = this.users.users.get(userId);
    if (!u || u.tenantId !== tenantId) return null;
    const next = { ...u, pcSerial: serial };
    this.users.users.set(userId, next);
    this.audit.entries.push({
      id: `audit-${++this.seq}`,
      tenantId,
      userId: audit.userId,
      action: audit.action,
      entity: 'User',
      entityId: userId,
      metadata: { pcSerial: serial },
      createdAt: new Date(),
    } as never);
    return this.serialOf(next);
  }
  async customersLite(tenantId: string) {
    return [...this.customers.customers.values()]
      .filter((c) => c.tenantId === tenantId && c.isActive)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }));
  }
}
