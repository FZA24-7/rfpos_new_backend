import { localDateString } from '@mafk/shared';
import type { DeskBill, DeskBillItem } from '../domain/sale-desk.js';
import {
  ZERO,
  add,
  addQty,
  returnedValue,
  showQty,
  sub,
  subQty,
  sumMoney,
  tenderOf,
} from './sale-desk-calc.js';
import { toReportCsv } from './csv.js';

export interface ReportColumn {
  key: string;
  label: string;
  align: 'left' | 'right';
}
export type ReportCell = string | number;
export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
}

export interface ReportContext {
  timeZone: string;
  cashierName: (id: string) => string;
}

const NO_SALESMAN = '(No salesman)';
const col = (key: string, label: string, align: 'left' | 'right' = 'left'): ReportColumn => ({
  key,
  label,
  align,
});
const num = (key: string, label: string): ReportColumn => col(key, label, 'right');

const timeOf = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

const salesmanOf = (i: DeskBillItem): string => i.salesman?.trim() || NO_SALESMAN;
const matches = (i: DeskBillItem, salesman?: string): boolean =>
  !salesman || salesmanOf(i).toLowerCase() === salesman.trim().toLowerCase();

/** Money/quantity totals of a set of lines. */
interface Acc {
  bills: Set<string>;
  qty: string;
  sales: string;
  returns: string;
}
const emptyAcc = (): Acc => ({ bills: new Set(), qty: '0.000', sales: ZERO, returns: ZERO });
const accItem = (a: Acc, billId: string, i: DeskBillItem): void => {
  a.bills.add(billId);
  a.qty = addQty(a.qty, subQty(i.quantity, i.returnedQuantity));
  a.sales = add(a.sales, i.lineTotal);
  a.returns = add(a.returns, returnedValue(i));
};
const accCells = (a: Acc): Record<string, ReportCell> => ({
  bills: a.bills.size,
  qty: showQty(a.qty),
  sales: a.sales,
  returns: a.returns,
  net: sub(a.sales, a.returns),
});
const sumAcc = (list: Acc[]): Acc => {
  const t = emptyAcc();
  for (const a of list) {
    a.bills.forEach((b) => t.bills.add(b));
    t.qty = addQty(t.qty, a.qty);
    t.sales = add(t.sales, a.sales);
    t.returns = add(t.returns, a.returns);
  }
  return t;
};

const billReturns = (b: DeskBill, salesman?: string): string =>
  sumMoney(b.items.filter((i) => matches(i, salesman)).map(returnedValue));
const billSales = (b: DeskBill, salesman?: string): string =>
  sumMoney(b.items.filter((i) => matches(i, salesman)).map((i) => i.lineTotal));
const billQty = (b: DeskBill, salesman?: string): string =>
  showQty(
    b.items
      .filter((i) => matches(i, salesman))
      .reduce((q, i) => addQty(q, subQty(i.quantity, i.returnedQuantity)), '0.000'),
  );

const sortRows = (rows: Record<string, ReportCell>[], keys: string[]) =>
  rows.sort((a, b) => {
    for (const k of keys) {
      const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''));
      if (c !== 0) return c;
    }
    return 0;
  });

const totalsOf = (
  rows: Record<string, ReportCell>[],
  moneyKeys: string[],
  countKeys: string[],
  qtyKeys: string[],
  first: { key: string; text: string },
): Record<string, ReportCell> => {
  const t: Record<string, ReportCell> = { [first.key]: first.text };
  for (const k of moneyKeys) t[k] = sumMoney(rows.map((r) => String(r[k] ?? ZERO)));
  for (const k of countKeys) t[k] = rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  for (const k of qtyKeys)
    t[k] = showQty(rows.reduce((q, r) => addQty(q, String(r[k] ?? '0')), '0.000'));
  return t;
};

// ───────────────────────── Daily Sales (Daily Closing) report ─────────────────────────

export const dailyClosingReport = (
  bills: DeskBill[],
  ctx: ReportContext,
  opts: { type: 'summary' | 'detail'; salesman?: string | undefined },
): ReportTable => {
  const { salesman } = opts;
  const withItems = salesman
    ? bills.filter((b) => b.items.some((i) => matches(i, salesman)))
    : bills;
  if (opts.type === 'detail') {
    const columns = salesman
      ? [
          col('date', 'Date'),
          col('time', 'Time'),
          col('billNo', 'Bill No'),
          col('shop', 'Shop'),
          col('customer', 'Customer'),
          num('qty', 'Qty'),
          num('sales', 'Sales'),
          num('returns', 'Returns'),
          num('net', 'Net Sales'),
        ]
      : [
          col('date', 'Date'),
          col('time', 'Time'),
          col('billNo', 'Bill No'),
          col('shop', 'Shop'),
          col('customer', 'Customer'),
          num('qty', 'Qty'),
          num('sales', 'Sales'),
          num('charges', 'Charges'),
          num('redemption', 'Redemption'),
          num('rounding', 'Rounding'),
          num('total', 'Bill Total'),
          num('cash', 'Cash'),
          num('card', 'Card'),
          num('onAccount', 'On Account'),
          num('returns', 'Returns'),
        ];
    const rows = withItems.map((b) => {
      const t = tenderOf(b);
      const sales = billSales(b, salesman);
      const returns = billReturns(b, salesman);
      return {
        date: localDateString(b.soldAt, ctx.timeZone),
        time: timeOf(b.soldAt, ctx.timeZone),
        billNo: b.invoiceNo,
        shop: b.storeName,
        customer: b.customerName ?? '',
        qty: billQty(b, salesman),
        sales,
        charges: add(b.serviceFee, b.otherCharges),
        redemption: b.voucherAmount,
        rounding: b.roundingAmount,
        total: b.grandTotal,
        cash: t.cash,
        card: t.card,
        onAccount: t.onAccount,
        returns,
        net: sub(sales, returns),
      };
    });
    const moneyKeys = salesman
      ? ['sales', 'returns', 'net']
      : [
          'sales',
          'charges',
          'redemption',
          'rounding',
          'total',
          'cash',
          'card',
          'onAccount',
          'returns',
        ];
    return {
      title: salesman ? `Daily Sales Report - ${salesman} (Detail)` : 'Daily Sales Report (Detail)',
      columns,
      rows,
      totals: totalsOf(rows, moneyKeys, [], ['qty'], { key: 'billNo', text: 'Total' }),
    };
  }

  // summary: one line per day per shop
  const groups = new Map<string, DeskBill[]>();
  for (const b of withItems) {
    const k = `${localDateString(b.soldAt, ctx.timeZone)}|${b.storeName}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const columns = salesman
    ? [
        col('date', 'Date'),
        col('shop', 'Shop'),
        num('bills', 'Bills'),
        num('qty', 'Qty'),
        num('sales', 'Sales'),
        num('returns', 'Returns'),
        num('net', 'Net Sales'),
      ]
    : [
        col('date', 'Date'),
        col('shop', 'Shop'),
        num('bills', 'Bills'),
        num('qty', 'Qty'),
        num('sales', 'Sales'),
        num('charges', 'Charges'),
        num('redemption', 'Redemption'),
        num('rounding', 'Rounding'),
        num('total', 'Total'),
        num('cash', 'Cash'),
        num('card', 'Card'),
        num('onAccount', 'On Account'),
        num('returns', 'Returns'),
        num('net', 'Net Total'),
      ];
  const rows = [...groups.entries()].map(([k, list]) => {
    const [date = '', shop = ''] = k.split('|');
    const tenders = list.map(tenderOf);
    const sales = sumMoney(list.map((b) => billSales(b, salesman)));
    const returns = sumMoney(list.map((b) => billReturns(b, salesman)));
    const total = sumMoney(list.map((b) => b.grandTotal));
    return {
      date,
      shop,
      bills: list.length,
      qty: showQty(list.reduce((q, b) => addQty(q, billQty(b, salesman)), '0.000')),
      sales,
      charges: sumMoney(list.map((b) => add(b.serviceFee, b.otherCharges))),
      redemption: sumMoney(list.map((b) => b.voucherAmount)),
      rounding: sumMoney(list.map((b) => b.roundingAmount)),
      total,
      cash: sumMoney(tenders.map((t) => t.cash)),
      card: sumMoney(tenders.map((t) => t.card)),
      onAccount: sumMoney(tenders.map((t) => t.onAccount)),
      returns,
      net: salesman ? sub(sales, returns) : sub(total, returns),
    };
  });
  sortRows(rows, ['date', 'shop']);
  const moneyKeys = salesman
    ? ['sales', 'returns', 'net']
    : [
        'sales',
        'charges',
        'redemption',
        'rounding',
        'total',
        'cash',
        'card',
        'onAccount',
        'returns',
        'net',
      ];
  return {
    title: salesman ? `Daily Sales Report - ${salesman}` : 'Daily Sales Report',
    columns,
    rows,
    totals: totalsOf(rows, moneyKeys, ['bills'], ['qty'], { key: 'date', text: 'Total' }),
  };
};

// ───────────────────────── Bill Wise report ─────────────────────────

export const billWiseReport = (
  bills: DeskBill[],
  ctx: ReportContext,
  opts: { type: 'summary' | 'detail' },
): ReportTable => {
  if (opts.type === 'detail') {
    const rows: Record<string, ReportCell>[] = [];
    for (const b of bills) {
      for (const i of b.items) {
        const returns = returnedValue(i);
        rows.push({
          billNo: b.invoiceNo,
          date: localDateString(b.soldAt, ctx.timeZone),
          shop: b.storeName,
          product: i.productName,
          sku: i.sku,
          salesman: i.salesman ?? '',
          qty: showQty(i.quantity),
          sales: i.lineTotal,
          returns,
          net: sub(i.lineTotal, returns),
        });
      }
    }
    return {
      title: 'Bill Wise Sales (Detail)',
      columns: [
        col('billNo', 'Bill No'),
        col('date', 'Date'),
        col('shop', 'Shop'),
        col('product', 'Product'),
        col('sku', 'SKU'),
        col('salesman', 'Salesman'),
        num('qty', 'Qty'),
        num('sales', 'Sales'),
        num('returns', 'Returns'),
        num('net', 'Net'),
      ],
      rows,
      totals: totalsOf(rows, ['sales', 'returns', 'net'], [], ['qty'], {
        key: 'billNo',
        text: 'Total',
      }),
    };
  }
  const rows = bills.map((b) => {
    const t = tenderOf(b);
    const returns = billReturns(b);
    return {
      billNo: b.invoiceNo,
      date: localDateString(b.soldAt, ctx.timeZone),
      shop: b.storeName,
      region: b.storeRegion ?? '',
      cashier: ctx.cashierName(b.cashierId),
      customer: b.customerName ?? '',
      total: b.grandTotal,
      cash: t.cash,
      card: t.card,
      onAccount: t.onAccount,
      redemption: t.redemption,
      returns,
      fbr: b.fbrInvoiceNo ?? '',
    };
  });
  return {
    title: 'Bill Wise Sales',
    columns: [
      col('billNo', 'Bill No'),
      col('date', 'Date'),
      col('shop', 'Shop'),
      col('region', 'Region'),
      col('cashier', 'Cashier'),
      col('customer', 'Customer'),
      num('total', 'Bill Total'),
      num('cash', 'Cash'),
      num('card', 'Card'),
      num('onAccount', 'On Account'),
      num('redemption', 'Redemption'),
      num('returns', 'Returns'),
      col('fbr', 'FBR Inv #'),
    ],
    rows,
    totals: totalsOf(
      rows,
      ['total', 'cash', 'card', 'onAccount', 'redemption', 'returns'],
      [],
      [],
      { key: 'billNo', text: 'Total' },
    ),
  };
};

// ───────────────────────── Sales Person wise report ─────────────────────────

export type SalesPersonType =
  'day-wise' | 'consolidated' | 'shop-wise' | 'cashier-wise' | 'consolidated-summary';

export const salesPersonReport = (
  bills: DeskBill[],
  ctx: ReportContext,
  opts: { type: SalesPersonType; salesman?: string | undefined },
): ReportTable => {
  const groupKeyOf: Record<SalesPersonType, (b: DeskBill, i: DeskBillItem) => string[]> = {
    'day-wise': (b, i) => [localDateString(b.soldAt, ctx.timeZone), salesmanOf(i)],
    consolidated: (_b, i) => [salesmanOf(i), i.productName, i.sku],
    'shop-wise': (b, i) => [b.storeName, salesmanOf(i)],
    'cashier-wise': (b, i) => [ctx.cashierName(b.cashierId), salesmanOf(i)],
    'consolidated-summary': (_b, i) => [salesmanOf(i)],
  };
  const groups = new Map<string, { key: string[]; acc: Acc }>();
  for (const b of bills) {
    for (const i of b.items) {
      if (!matches(i, opts.salesman)) continue;
      const key = groupKeyOf[opts.type](b, i);
      const id = key.join('\u0001');
      const g = groups.get(id) ?? { key, acc: emptyAcc() };
      accItem(g.acc, b.id, i);
      groups.set(id, g);
    }
  }
  const list = [...groups.values()];
  const totalAcc = sumAcc(list.map((g) => g.acc));
  // a bill with several salesmen is counted once per salesman row but once in the grand total
  const grandBills = new Set<string>();
  list.forEach((g) => g.acc.bills.forEach((x) => grandBills.add(x)));
  totalAcc.bills = grandBills;

  const common = [
    num('bills', 'Bills'),
    num('qty', 'Qty'),
    num('sales', 'Sales'),
    num('returns', 'Returns'),
    num('net', 'Net Sales'),
  ];
  let columns: ReportColumn[];
  let keyNames: string[];
  let title: string;
  switch (opts.type) {
    case 'day-wise':
      keyNames = ['date', 'salesman'];
      columns = [col('date', 'Date'), col('salesman', 'Sales Person'), ...common];
      title = 'Sales Person Wise Sales - Day-wise';
      break;
    case 'consolidated':
      keyNames = ['salesman', 'product', 'sku'];
      columns = [
        col('salesman', 'Sales Person'),
        col('product', 'Product'),
        col('sku', 'SKU'),
        ...common.slice(1),
      ];
      title = 'Sales Person Wise Sales - Consolidated';
      break;
    case 'shop-wise':
      keyNames = ['shop', 'salesman'];
      columns = [col('shop', 'Shop'), col('salesman', 'Sales Person'), ...common];
      title = 'Sales Person Wise Sales - Shop-wise';
      break;
    case 'cashier-wise':
      keyNames = ['cashier', 'salesman'];
      columns = [col('cashier', 'Cashier'), col('salesman', 'Sales Person'), ...common];
      title = 'Sales Person Wise Sales - Cashier-wise';
      break;
    default:
      keyNames = ['salesman'];
      columns = [
        col('salesman', 'Sales Person'),
        ...common,
        num('avg', 'Avg Bill'),
        num('share', 'Share %'),
      ];
      title = 'Sales Person Wise Sales - Consolidated Summary';
  }
  const rows = list.map((g) => {
    const row: Record<string, ReportCell> = {};
    keyNames.forEach((k, idx) => (row[k] = g.key[idx] ?? ''));
    Object.assign(row, accCells(g.acc));
    if (opts.type === 'consolidated-summary') {
      const net = sub(g.acc.sales, g.acc.returns);
      row.avg = g.acc.bills.size > 0 ? avgOf(net, g.acc.bills.size) : ZERO;
      row.share = shareOf(net, sub(totalAcc.sales, totalAcc.returns));
    }
    return row;
  });
  if (opts.type === 'consolidated-summary') {
    rows.sort((a, b) => Number(b.net) - Number(a.net));
  } else {
    sortRows(rows, keyNames);
  }
  const totals: Record<string, ReportCell> = { [keyNames[0]!]: 'Total', ...accCells(totalAcc) };
  if (opts.type === 'consolidated-summary') {
    totals.avg =
      totalAcc.bills.size > 0
        ? avgOf(sub(totalAcc.sales, totalAcc.returns), totalAcc.bills.size)
        : ZERO;
    totals.share = rows.length > 0 ? '100.0' : '0.0';
  }
  return { title, columns, rows, totals: rows.length > 0 ? totals : null };
};

const avgOf = (money: string, n: number): string => {
  const cents = BigInt(money.replace('.', ''));
  const d = BigInt(n);
  const r = (cents * 2n + d) / (d * 2n);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
const shareOf = (part: string, whole: string): string => {
  const p = BigInt(part.replace('.', ''));
  const w = BigInt(whole.replace('.', ''));
  if (w === 0n) return '0.0';
  const tenths = (p * 2000n + w) / (w * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
};

export const tableToCsv = (t: ReportTable, preamble: string[][]): string =>
  toReportCsv([
    ...preamble,
    t.columns.map((c) => c.label),
    ...t.rows.map((r) => t.columns.map((c) => r[c.key] ?? '')),
    ...(t.totals ? [t.columns.map((c) => t.totals![c.key] ?? '')] : []),
  ]);
