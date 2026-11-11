import {
  DEFAULT_RECEIPT_HEADS,
  FUND_TRANSFER_TYPES,
  localDateString,
  localDayRange,
  normalizePcSerial,
  roundDecimalString,
} from '@mafk/shared';
import type {
  ClearClosingInput,
  DeskBillListQuery,
  DeskBillWiseQuery,
  DeskDailyClosingQuery,
  DeskSalesPersonQuery,
  FbrListQuery,
  FbrRepostInput,
  PcSerialInput,
  RepostCashInput,
  SaveCashActivityInput,
  UpdateTenderInput,
  CashActivityQuery,
  CashActivityListQuery,
} from '@mafk/validation';
import type { Repositories } from '../domain/ports.js';
import type {
  CashActivityRecord,
  CashActivityValues,
  DeskBill,
  DeskRange,
} from '../domain/sale-desk.js';
import { DomainError, type TenderMethod } from '../domain/types.js';
import { toReportCsv } from './csv.js';
import {
  ZERO,
  add,
  daySales,
  isPos,
  sheetFigures,
  sheetProblems,
  tenderOf,
  type DaySales,
  type SheetProblem,
} from './sale-desk-calc.js';
import {
  billWiseReport,
  dailyClosingReport,
  salesPersonReport,
  tableToCsv,
  type ReportTable,
} from './sale-desk-reports.js';

export interface DeskActor {
  id: string;
  tenantId: string;
  permissions: readonly string[];
  /** Serial of the PC making the request (desktop app header), if any. */
  pcSerial?: string | null;
}

export interface DeskReportResult {
  meta: {
    from: string;
    to: string;
    shop: string;
    region: string;
    salesman: string;
    type: string;
    currency: string;
    timeZone: string;
  };
  table: ReportTable;
}

const money = (v: string): string => roundDecimalString(v, 2);

export class SaleDeskService {
  constructor(private readonly repos: Repositories) {}

  // ───────────────────────── shared helpers ─────────────────────────

  private async tenantInfo(tenantId: string) {
    const t = await this.repos.tenants.findDetailById(tenantId);
    if (!t) throw new DomainError('NOT_FOUND', 'Business not found.', 404);
    return { timeZone: t.timezone ?? 'Asia/Karachi', currency: t.currency ?? 'PKR' };
  }

  private async shopOrThrow(tenantId: string, storeId: string) {
    const shop = (await this.repos.saleDesk.listShops(tenantId)).find((s) => s.id === storeId);
    if (!shop) throw new DomainError('VALIDATION_ERROR', 'Selected shop does not exist.', 422);
    return shop;
  }

  private dayRange(
    timeZone: string,
    from: string,
    to: string,
    extra: { storeId?: string | undefined; region?: string | undefined } = {},
  ): DeskRange {
    const { start, end } = localDayRange(from, to, timeZone);
    return { start, end, storeId: extra.storeId, region: extra.region };
  }

  private async cashierNames(tenantId: string): Promise<(id: string) => string> {
    const users = await this.repos.users.listByTenant(tenantId);
    const map = new Map(users.map((u) => [u.id, u.displayName]));
    return (id) => map.get(id) ?? 'Unknown';
  }

  // ───────────────────────── lookups ─────────────────────────

  async lookups(actor: DeskActor) {
    const { tenantId } = actor;
    const info = await this.tenantInfo(tenantId);
    const [shops, salesmen, terminals, expenseHeads, customers] = await Promise.all([
      this.repos.saleDesk.listShops(tenantId),
      this.repos.saleDesk.listSalesmen(tenantId),
      this.repos.saleDesk.listTerminals(tenantId),
      this.repos.saleDesk.listExpenseHeads(tenantId),
      this.repos.saleDesk.customersLite(tenantId),
    ]);
    const regions = [...new Set(shops.map((s) => s.region).filter((r): r is string => !!r))].sort();
    return {
      shops,
      regions,
      salesmen,
      terminals,
      expenseHeads,
      receiptHeads: [...DEFAULT_RECEIPT_HEADS],
      transferTypes: [...FUND_TRANSFER_TYPES],
      customers,
      today: localDateString(new Date(), info.timeZone),
      timeZone: info.timeZone,
      currency: info.currency,
    };
  }

  async setShopRegion(actor: DeskActor, storeId: string, region: string) {
    const shop = await this.repos.saleDesk.setShopRegion(
      actor.tenantId,
      storeId,
      region.trim() || null,
    );
    if (!shop) throw new DomainError('NOT_FOUND', 'Shop not found.', 404);
    return shop;
  }

  // ───────────────────────── reports ─────────────────────────

  private async reportSetup(
    actor: DeskActor,
    q: { from: string; to: string; storeId?: string | undefined; region?: string | undefined },
  ) {
    const info = await this.tenantInfo(actor.tenantId);
    const shop = q.storeId ? await this.shopOrThrow(actor.tenantId, q.storeId) : null;
    const range = this.dayRange(info.timeZone, q.from, q.to, q);
    const bills = await this.repos.saleDesk.listBills(actor.tenantId, range);
    const cashierName = await this.cashierNames(actor.tenantId);
    return { info, shop, bills, ctx: { timeZone: info.timeZone, cashierName } };
  }

  private metaOf(
    q: { from: string; to: string },
    info: { timeZone: string; currency: string },
    shop: { name: string } | null,
    extra: { region?: string | undefined; salesman?: string | undefined; type: string },
  ): DeskReportResult['meta'] {
    return {
      from: q.from,
      to: q.to,
      shop: shop?.name ?? 'All shops',
      region: extra.region ?? '',
      salesman: extra.salesman ?? '',
      type: extra.type,
      currency: info.currency,
      timeZone: info.timeZone,
    };
  }

  async dailyClosing(actor: DeskActor, q: DeskDailyClosingQuery): Promise<DeskReportResult> {
    const { info, shop, bills, ctx } = await this.reportSetup(actor, q);
    const table = dailyClosingReport(bills, ctx, {
      type: q.type,
      salesman: q.salesman || undefined,
    });
    return { meta: this.metaOf(q, info, shop, { salesman: q.salesman, type: q.type }), table };
  }

  async billWise(actor: DeskActor, q: DeskBillWiseQuery): Promise<DeskReportResult> {
    const { info, shop, bills, ctx } = await this.reportSetup(actor, q);
    const table = billWiseReport(bills, ctx, { type: q.type });
    return { meta: this.metaOf(q, info, shop, { region: q.region, type: q.type }), table };
  }

  async salesPerson(actor: DeskActor, q: DeskSalesPersonQuery): Promise<DeskReportResult> {
    const { info, shop, bills, ctx } = await this.reportSetup(actor, q);
    const table = salesPersonReport(bills, ctx, {
      type: q.type,
      salesman: q.salesman || undefined,
    });
    return { meta: this.metaOf(q, info, shop, { salesman: q.salesman, type: q.type }), table };
  }

  /** CSV (opens in Excel) of a report: a short header block, then the table and its total line. */
  reportCsv(r: DeskReportResult): { filename: string; content: string } {
    const m = r.meta;
    const content =
      '\uFEFF' +
      tableToCsv(r.table, [
        [r.table.title],
        ['From', m.from, 'To', m.to],
        [
          'Shop',
          m.shop,
          ...(m.region ? ['Region', m.region] : []),
          ...(m.salesman ? ['Sales person', m.salesman] : []),
        ],
        [],
      ]);
    const slug = r.table.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return { filename: `${slug}-${m.from}-to-${m.to}.csv`, content };
  }

  // ───────────────────────── Daily Cash Activity ─────────────────────────

  private async liveSales(
    tenantId: string,
    storeId: string,
    date: string,
    timeZone: string,
  ): Promise<DaySales> {
    const range = this.dayRange(timeZone, date, date, { storeId });
    const [bills, refunds] = await Promise.all([
      this.repos.saleDesk.listBills(tenantId, range),
      this.repos.saleDesk.listRefunds(tenantId, range),
    ]);
    return daySales(bills, refunds);
  }

  private view(
    record: CashActivityRecord | null,
    figures: ReturnType<typeof sheetFigures>,
    lines: Pick<
      CashActivityValues,
      'expenseLines' | 'receiptLines' | 'transferLines' | 'terminalLines'
    >,
    problems: SheetProblem[],
    voucherNo: string | null,
    closed: boolean,
    storeId: string,
    date: string,
  ) {
    return {
      storeId,
      date,
      saved: !!record,
      closed,
      voucherNo,
      closedAt: record?.closedAt ?? null,
      ...figures,
      ...lines,
      problems,
    };
  }

  async cashActivity(actor: DeskActor, q: CashActivityQuery) {
    const { tenantId } = actor;
    await this.shopOrThrow(tenantId, q.storeId);
    const info = await this.tenantInfo(tenantId);
    const saved = await this.repos.saleDesk.findActivity(tenantId, q.storeId, q.date);
    if (saved?.closed) {
      return this.view(
        saved,
        saved,
        saved,
        sheetProblems(saved, saved.terminalLines),
        saved.voucherNo,
        true,
        q.storeId,
        q.date,
      );
    }
    const prev = await this.repos.saleDesk.findPreviousActivity(tenantId, q.storeId, q.date);
    const sales = await this.liveSales(tenantId, q.storeId, q.date, info.timeZone);
    const lines = {
      expenseLines: saved?.expenseLines ?? [],
      receiptLines: saved?.receiptLines ?? [],
      transferLines: saved?.transferLines ?? [],
      terminalLines: saved?.terminalLines ?? [],
    };
    const f = sheetFigures({
      openingPettyCash: prev?.closingPettyCash ?? ZERO,
      openingCash: prev?.netAvailable ?? ZERO,
      receivePettyCash: saved?.receivePettyCash ?? ZERO,
      sales,
      ...lines,
    });
    return this.view(
      saved,
      f,
      lines,
      sheetProblems(f, lines.terminalLines),
      saved?.voucherNo ?? null,
      false,
      q.storeId,
      q.date,
    );
  }

  async saveCashActivity(actor: DeskActor, input: SaveCashActivityInput) {
    const { tenantId } = actor;
    const shop = await this.shopOrThrow(tenantId, input.storeId);
    const info = await this.tenantInfo(tenantId);
    const today = localDateString(new Date(), info.timeZone);
    if (input.date > today) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A cash sheet cannot be recorded for a future date.',
        422,
      );
    }
    const existing = await this.repos.saleDesk.findActivity(tenantId, input.storeId, input.date);
    if (existing?.closed) {
      throw new DomainError(
        'DAY_CLOSED',
        'This day is closed. Clear the closing to change it.',
        409,
      );
    }
    const required = existing ? 'cash_activity.edit' : 'cash_activity.create';
    if (!actor.permissions.includes(required)) {
      throw new DomainError('FORBIDDEN', 'You do not have permission to do that.', 403);
    }
    const lines = {
      expenseLines: input.expenseLines.map((l) => ({
        head: l.head,
        description: l.description,
        amount: money(l.amount),
      })),
      receiptLines: input.receiptLines.map((l) => ({ head: l.head, amount: money(l.amount) })),
      transferLines: input.transferLines.map((l) => ({
        type: l.type,
        remarks: l.remarks,
        amount: money(l.amount),
      })),
      terminalLines: input.terminalLines.map((l) => ({
        terminal: l.terminal,
        gtech: money(l.gtech),
        settlement: money(l.settlement),
        batch: l.batch,
      })),
    };
    const prev = await this.repos.saleDesk.findPreviousActivity(
      tenantId,
      input.storeId,
      input.date,
    );
    const sales = await this.liveSales(tenantId, input.storeId, input.date, info.timeZone);
    const f = sheetFigures({
      openingPettyCash: prev?.closingPettyCash ?? ZERO,
      openingCash: prev?.netAvailable ?? ZERO,
      receivePettyCash: money(input.receivePettyCash),
      sales,
      ...lines,
    });
    const errors = sheetProblems(f, lines.terminalLines).filter((p) => p.level === 'error');
    if (errors.length > 0) {
      throw new DomainError('VALIDATION_ERROR', errors.map((e) => e.text).join(' '), 422);
    }
    const voucherNo = input.close ? `CV-${shop.code}-${input.date.replaceAll('-', '')}` : null;
    const saved = await this.repos.saleDesk.saveActivity(
      tenantId,
      input.storeId,
      input.date,
      { ...f, ...lines, voucherNo, closed: input.close },
      actor.id,
      {
        userId: actor.id,
        action: input.close ? 'CASH_ACTIVITY_CLOSED' : 'CASH_ACTIVITY_SAVED',
      },
    );
    return this.view(
      saved,
      saved,
      saved,
      sheetProblems(saved, saved.terminalLines),
      saved.voucherNo,
      saved.closed,
      input.storeId,
      input.date,
    );
  }

  async clearClosing(actor: DeskActor, input: ClearClosingInput) {
    const { tenantId } = actor;
    await this.shopOrThrow(tenantId, input.storeId);
    const existing = await this.repos.saleDesk.findActivity(tenantId, input.storeId, input.date);
    if (!existing) throw new DomainError('NOT_FOUND', 'There is no cash sheet for that day.', 404);
    if (!existing.closed) throw new DomainError('VALIDATION_ERROR', 'That day is not closed.', 422);
    if (await this.repos.saleDesk.hasClosedActivityAfter(tenantId, input.storeId, input.date)) {
      throw new DomainError(
        'DAY_CLOSED',
        'A later day is already closed. Clear the later closing first.',
        409,
      );
    }
    const saved = await this.repos.saleDesk.saveActivity(
      tenantId,
      input.storeId,
      input.date,
      { ...existing, voucherNo: null, closed: false },
      null,
      { userId: actor.id, action: 'CASH_ACTIVITY_REOPENED' },
    );
    return this.view(
      saved,
      saved,
      saved,
      sheetProblems(saved, saved.terminalLines),
      null,
      false,
      input.storeId,
      input.date,
    );
  }

  async listCashActivities(actor: DeskActor, q: CashActivityListQuery) {
    await this.shopOrThrow(actor.tenantId, q.storeId);
    const rows = await this.repos.saleDesk.listActivities(actor.tenantId, q.storeId, q.from, q.to);
    return {
      items: rows.map((r) => ({
        date: r.businessDate,
        voucherNo: r.voucherNo,
        closed: r.closed,
        totalSales: r.totalSales,
        cashSales: r.cashSales,
        totalExpense: r.totalExpense,
        netAvailable: r.netAvailable,
      })),
    };
  }

  /** Recomputes the sales figures and the carry-forward of every open saved sheet in the period, day by day. */
  async repostCashActivities(actor: DeskActor, input: RepostCashInput) {
    const { tenantId } = actor;
    await this.shopOrThrow(tenantId, input.storeId);
    const info = await this.tenantInfo(tenantId);
    const sheets = await this.repos.saleDesk.listActivities(
      tenantId,
      input.storeId,
      input.from,
      input.to,
    );
    let updated = 0;
    let skippedClosed = 0;
    for (const sheet of sheets) {
      const fresh = (await this.repos.saleDesk.findActivity(
        tenantId,
        input.storeId,
        sheet.businessDate,
      ))!;
      if (fresh.closed) {
        skippedClosed++;
        continue;
      }
      const prev = await this.repos.saleDesk.findPreviousActivity(
        tenantId,
        input.storeId,
        sheet.businessDate,
      );
      const sales = await this.liveSales(
        tenantId,
        input.storeId,
        sheet.businessDate,
        info.timeZone,
      );
      const f = sheetFigures({
        openingPettyCash: prev?.closingPettyCash ?? ZERO,
        openingCash: prev?.netAvailable ?? ZERO,
        receivePettyCash: fresh.receivePettyCash,
        sales,
        expenseLines: fresh.expenseLines,
        receiptLines: fresh.receiptLines,
        transferLines: fresh.transferLines,
      });
      await this.repos.saleDesk.saveActivity(
        tenantId,
        input.storeId,
        sheet.businessDate,
        {
          ...f,
          expenseLines: fresh.expenseLines,
          receiptLines: fresh.receiptLines,
          transferLines: fresh.transferLines,
          terminalLines: fresh.terminalLines,
          voucherNo: null,
          closed: false,
        },
        null,
        { userId: actor.id, action: 'CASH_ACTIVITY_REPOSTED' },
      );
      updated++;
    }
    return { updated, skippedClosed, from: input.from, to: input.to };
  }

  // ───────────────────────── Cash and Credit Card Update ─────────────────────────

  async listBills(actor: DeskActor, q: DeskBillListQuery) {
    const info = await this.tenantInfo(actor.tenantId);
    await this.shopOrThrow(actor.tenantId, q.storeId);
    const bills = await this.repos.saleDesk.listBills(
      actor.tenantId,
      this.dayRange(info.timeZone, q.date, q.date, { storeId: q.storeId }),
    );
    const needle = q.search?.trim().toLowerCase();
    return {
      items: bills
        .filter(
          (b) =>
            !needle ||
            b.invoiceNo.toLowerCase().includes(needle) ||
            (b.customerName ?? '').toLowerCase().includes(needle),
        )
        .map((b) => ({
          id: b.id,
          invoiceNo: b.invoiceNo,
          soldAt: b.soldAt,
          customerName: b.customerName,
          grandTotal: b.grandTotal,
          status: b.status,
        })),
    };
  }

  private terminalOf(bill: DeskBill): string {
    const card = bill.payments.find((p) => p.method === 'CARD');
    return /(?:^|\s)T:(\S+)/.exec(card?.reference ?? '')?.[1] ?? '';
  }

  /** Why this bill's tender cannot be edited here, or null when it can. */
  private async lockReason(
    tenantId: string,
    bill: DeskBill,
    timeZone: string,
  ): Promise<string | null> {
    if (bill.status === 'VOID') return 'This bill is void.';
    if (bill.returnCount > 0 || bill.status !== 'COMPLETED') {
      return 'This bill has refunds, so how it was paid can no longer be changed.';
    }
    if (bill.payments.some((p) => p.method === 'BANK_TRANSFER')) {
      return 'This bill includes a bank transfer, which cannot be edited here.';
    }
    const day = localDateString(bill.soldAt, timeZone);
    const sheet = await this.repos.saleDesk.findActivity(tenantId, bill.storeId, day);
    if (sheet?.closed) {
      return `The cash sheet of ${day} is closed. Clear the closing in Daily Cash Activity first.`;
    }
    return null;
  }

  async tenderOfBill(actor: DeskActor, saleId: string) {
    const info = await this.tenantInfo(actor.tenantId);
    const bill = await this.repos.saleDesk.findBill(actor.tenantId, saleId);
    if (!bill) throw new DomainError('NOT_FOUND', 'Bill not found.', 404);
    const t = tenderOf(bill);
    return {
      id: bill.id,
      invoiceNo: bill.invoiceNo,
      soldAt: bill.soldAt,
      storeId: bill.storeId,
      storeName: bill.storeName,
      netReceivable: bill.grandTotal,
      cash: t.cash,
      card: t.card,
      onAccount: t.onAccount,
      redemption: t.redemption,
      customerId: bill.customerId,
      customerName: bill.customerName,
      terminal: this.terminalOf(bill),
      fbrInvoiceNo: bill.fbrInvoiceNo ?? '',
      lockedReason: await this.lockReason(actor.tenantId, bill, info.timeZone),
    };
  }

  async updateTender(actor: DeskActor, saleId: string, input: UpdateTenderInput) {
    const info = await this.tenantInfo(actor.tenantId);
    const bill = await this.repos.saleDesk.findBill(actor.tenantId, saleId);
    if (!bill) throw new DomainError('NOT_FOUND', 'Bill not found.', 404);
    const locked = await this.lockReason(actor.tenantId, bill, info.timeZone);
    if (locked) throw new DomainError('BILL_LOCKED', locked, 409);

    const cash = money(input.cash);
    const card = money(input.card);
    const onAccount = money(input.onAccount);
    const entered = add(add(cash, card), onAccount);
    if (entered !== bill.grandTotal) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Cash + card + on account (${entered}) must equal the net receivable amount (${bill.grandTotal}).`,
        422,
      );
    }
    const customerId = input.customerId ?? (isPos(onAccount) ? bill.customerId : null) ?? null;
    if (isPos(onAccount) && !customerId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Choose the customer for the amount on account.',
        422,
      );
    }
    // keep card number / approval from the original card payment, replace only the terminal tag
    const oldRef = bill.payments.find((p) => p.method === 'CARD')?.reference ?? '';
    const kept = oldRef.replace(/(?:^|\s)T:\S+/g, '').trim();
    const terminal = input.terminal.trim().replace(/\s+/g, '_');
    const reference =
      [kept, terminal ? `T:${terminal}` : ''].filter(Boolean).join(' ').slice(0, 64) || null;

    const payments: { method: TenderMethod; amount: string; reference: string | null }[] = [];
    if (isPos(cash)) payments.push({ method: 'CASH', amount: cash, reference: null });
    if (isPos(card)) payments.push({ method: 'CARD', amount: card, reference });
    if (isPos(onAccount))
      payments.push({ method: 'CUSTOMER_CREDIT', amount: onAccount, reference: null });

    const updated = await this.repos.saleDesk.updateTender({
      tenantId: actor.tenantId,
      saleId,
      payments,
      customerId: isPos(onAccount) || input.customerId ? customerId : bill.customerId,
      fbrInvoiceNo: input.fbrInvoiceNo.trim() || null,
      audit: { userId: actor.id, action: 'SALE_TENDER_UPDATED' },
    });
    return this.tenderOfBill(actor, updated.id);
  }

  // ───────────────────────── FBR repost period ─────────────────────────

  async fbrList(actor: DeskActor, q: FbrListQuery) {
    const info = await this.tenantInfo(actor.tenantId);
    if (q.storeId) await this.shopOrThrow(actor.tenantId, q.storeId);
    const bills = await this.repos.saleDesk.listBills(
      actor.tenantId,
      this.dayRange(info.timeZone, q.from, q.to, { storeId: q.storeId }),
    );
    const items = bills
      .filter((b) =>
        q.status === 'all' ? true : q.status === 'posted' ? !!b.fbrInvoiceNo : !b.fbrInvoiceNo,
      )
      .map((b) => ({
        id: b.id,
        invoiceNo: b.invoiceNo,
        date: localDateString(b.soldAt, info.timeZone),
        storeName: b.storeName,
        customerName: b.customerName,
        grandTotal: b.grandTotal,
        taxTotal: b.taxTotal,
        fbrInvoiceNo: b.fbrInvoiceNo ?? '',
        status: b.fbrInvoiceNo ? ('POSTED' as const) : ('PENDING' as const),
      }));
    return { items, pending: items.filter((i) => i.status === 'PENDING').length };
  }

  fbrCsv(items: Awaited<ReturnType<SaleDeskService['fbrList']>>['items'], q: FbrListQuery) {
    const content =
      '\uFEFF' +
      toReportCsv([
        ['Bill No', 'Date', 'Shop', 'Customer', 'Bill Total', 'Tax', 'FBR Inv #', 'Status'],
        ...items.map((i) => [
          i.invoiceNo,
          i.date,
          i.storeName,
          i.customerName ?? '',
          i.grandTotal,
          i.taxTotal,
          i.fbrInvoiceNo,
          i.status,
        ]),
      ]);
    return { filename: `fbr-${q.status}-${q.from}-to-${q.to}.csv`, content };
  }

  async fbrRepost(actor: DeskActor, input: FbrRepostInput) {
    const info = await this.tenantInfo(actor.tenantId);
    // a bill whose day is closed keeps its figures, but the FBR number is not a cash figure, so it stays editable
    void info;
    const updated = await this.repos.saleDesk.setFbrNumbers(
      actor.tenantId,
      input.items.map((i) => ({ saleId: i.saleId, fbrInvoiceNo: i.fbrInvoiceNo.trim() || null })),
      { userId: actor.id, action: 'FBR_REPOSTED' },
    );
    return { updated };
  }

  // ───────────────────────── User PC serial ─────────────────────────

  async listSerials(actor: DeskActor) {
    return { items: await this.repos.saleDesk.listUserSerials(actor.tenantId) };
  }

  async setSerial(actor: DeskActor, userId: string, input: PcSerialInput) {
    const serial = normalizePcSerial(input.serial);
    if (userId === actor.id && serial && serial !== normalizePcSerial(actor.pcSerial)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'That would lock your own ID out of this PC. Sign in on the PC you want to bind and press Get Serial there.',
        422,
      );
    }
    const updated = await this.repos.saleDesk.setUserSerial(actor.tenantId, userId, serial, {
      userId: actor.id,
      action: serial ? 'USER_PC_SERIAL_SET' : 'USER_PC_SERIAL_CLEARED',
    });
    if (!updated) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    // Sessions opened on another PC must not survive the change.
    if (userId !== actor.id)
      await this.repos.sessions.revokeAllForUser(userId, 'PC_SERIAL_CHANGED');
    return updated;
  }
}
