import { addDecimalStrings, compareDecimalStrings, subtractDecimalStrings } from '@mafk/shared';
import type { DeskBill, DeskBillItem, DeskRefund } from '../domain/sale-desk.js';

export const ZERO = '0.00';
export const add = (a: string, b: string): string => addDecimalStrings(a, b, 2);
export const sub = (a: string, b: string): string => subtractDecimalStrings(a, b, 2);
export const isNeg = (a: string): boolean => compareDecimalStrings(a, '0', 2) < 0;
export const isPos = (a: string): boolean => compareDecimalStrings(a, '0', 2) > 0;
export const sumMoney = (values: string[]): string => values.reduce(add, ZERO);

const toCents = (v: string): bigint => {
  const neg = v.trim().startsWith('-');
  const [w = '0', f = ''] = v.trim().replace('-', '').split('.');
  const c = BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
};
const fromCents = (c: bigint): string => {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const s = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};
/** "1.500" -> 1500n (thousandths). */
const toMilli = (v: string): bigint => {
  const [w = '0', f = ''] = v.trim().split('.');
  return BigInt(w) * 1000n + BigInt((f + '000').slice(0, 3));
};
/** Trims "2.000" to "2" and "1.500" to "1.5" for display. */
export const showQty = (v: string): string => (v.includes('.') ? v.replace(/\.?0+$/, '') : v);
export const addQty = (a: string, b: string): string => {
  const t = toMilli(a) + toMilli(b);
  return `${t / 1000n}.${String(t % 1000n).padStart(3, '0')}`;
};
export const subQty = (a: string, b: string): string => {
  const t = toMilli(a) - toMilli(b);
  const neg = t < 0n;
  const abs = neg ? -t : t;
  return `${neg ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`;
};

/** Value of the part of a line that was returned: lineTotal x returned / quantity, to the cent. */
export const returnedValue = (item: DeskBillItem): string => {
  const q = toMilli(item.quantity);
  const r = toMilli(item.returnedQuantity);
  if (q === 0n || r === 0n) return ZERO;
  const c = toCents(item.lineTotal);
  return fromCents((c * r * 2n + q) / (q * 2n)); // rounds half up
};

export interface TenderSplit {
  cash: string;
  card: string;
  onAccount: string;
  redemption: string;
}

/** What a bill took in, per method. Change handed back comes out of cash; bank transfers count with cards. */
export const tenderOf = (b: DeskBill): TenderSplit => {
  let cash = ZERO;
  let card = ZERO;
  let onAccount = ZERO;
  for (const p of b.payments) {
    if (p.method === 'CASH') cash = add(cash, p.amount);
    else if (p.method === 'CUSTOMER_CREDIT') onAccount = add(onAccount, p.amount);
    else card = add(card, p.amount);
  }
  return { cash: sub(cash, b.changeDue), card, onAccount, redemption: b.voucherAmount };
};

export interface DaySales extends TenderSplit {
  total: string;
}

/** The figures Daily Cash Activity takes from the day's bills: net of refunds paid out that day. */
export const daySales = (bills: DeskBill[], refunds: DeskRefund[]): DaySales => {
  let cash = ZERO;
  let card = ZERO;
  let onAccount = ZERO;
  let redemption = ZERO;
  for (const b of bills) {
    const t = tenderOf(b);
    cash = add(cash, t.cash);
    card = add(card, t.card);
    onAccount = add(onAccount, t.onAccount);
    redemption = add(redemption, t.redemption);
  }
  for (const r of refunds) {
    if (r.refundMethod === 'CASH') cash = sub(cash, r.refundTotal);
    else if (r.refundMethod === 'CUSTOMER_CREDIT') onAccount = sub(onAccount, r.refundTotal);
    else card = sub(card, r.refundTotal);
  }
  return {
    cash,
    card,
    onAccount,
    redemption,
    total: sumMoney([cash, card, onAccount, redemption]),
  };
};

export interface SheetInput {
  openingPettyCash: string;
  openingCash: string;
  receivePettyCash: string;
  sales: DaySales;
  expenseLines: { amount: string }[];
  receiptLines: { amount: string }[];
  transferLines: { amount: string }[];
}

export interface SheetFigures {
  openingPettyCash: string;
  receivePettyCash: string;
  totalExpense: string;
  closingPettyCash: string;
  creditCardSales: string;
  onAccountSales: string;
  cashSales: string;
  redemptionAmount: string;
  totalSales: string;
  openingCash: string;
  adjustment: string;
  totalAvailable: string;
  depositedCash: string;
  netAvailable: string;
}

/** The sheet's arithmetic. Everything but the typed lines and the petty-cash top-up is derived. */
export const sheetFigures = (i: SheetInput): SheetFigures => {
  const totalExpense = sumMoney(i.expenseLines.map((l) => l.amount));
  const closingPettyCash = sub(add(i.openingPettyCash, i.receivePettyCash), totalExpense);
  const adjustment = sumMoney(i.receiptLines.map((l) => l.amount));
  const totalAvailable = sumMoney([i.openingCash, i.sales.cash, adjustment]);
  const depositedCash = sumMoney(i.transferLines.map((l) => l.amount));
  return {
    openingPettyCash: i.openingPettyCash,
    receivePettyCash: i.receivePettyCash,
    totalExpense,
    closingPettyCash,
    creditCardSales: i.sales.card,
    onAccountSales: i.sales.onAccount,
    cashSales: i.sales.cash,
    redemptionAmount: i.sales.redemption,
    totalSales: i.sales.total,
    openingCash: i.openingCash,
    adjustment,
    totalAvailable,
    depositedCash,
    netAvailable: sub(totalAvailable, depositedCash),
  };
};

export interface SheetProblem {
  level: 'error' | 'warning';
  text: string;
}

export const sheetProblems = (
  f: SheetFigures,
  terminals: { terminal: string; settlement: string }[],
): SheetProblem[] => {
  const out: SheetProblem[] = [];
  if (isNeg(f.closingPettyCash)) {
    out.push({
      level: 'error',
      text: `Expenses (${f.totalExpense}) are more than the petty cash available (${add(f.openingPettyCash, f.receivePettyCash)}).`,
    });
  }
  if (isNeg(f.netAvailable)) {
    out.push({
      level: 'error',
      text: `Cash deposited / transferred (${f.depositedCash}) is more than the cash available (${f.totalAvailable}).`,
    });
  }
  if (terminals.length > 0) {
    const settled = sumMoney(terminals.map((t) => t.settlement));
    if (compareDecimalStrings(settled, f.creditCardSales, 2) !== 0) {
      out.push({
        level: 'warning',
        text: `Terminal settlements (${settled}) do not match the credit card sales (${f.creditCardSales}).`,
      });
    }
  }
  return out;
};
