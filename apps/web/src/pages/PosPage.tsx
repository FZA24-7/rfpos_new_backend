import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import {
  addDecimalStrings,
  compareDecimalStrings,
  computeSale,
  roundDecimalString,
  SaleMathError,
  subtractDecimalStrings,
} from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type {
  CustomerListResult,
  CustomerWithBalance,
  PosProduct,
  SaleDetail,
  SaleListResult,
  SaleReturnDetail,
  TenderMethod,
  VoucherListResult,
  VoucherRecord,
} from '../api/types.js';
import { Card, CardBody, CardHeader } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { ReceiptModal } from '../components/ReceiptModal.js';

interface CartLine {
  product: PosProduct;
  quantity: string;
  discountPercent: string;
  /** Needs the price.change permission; empty = the catalogue price. */
  price: string;
  salesman: string;
  free: boolean;
}

type Tab = 'sales' | 'stock' | 'loyal';
const TENDERS: { value: TenderMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CUSTOMER_CREDIT', label: 'On account' },
];
const startOfToday = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const MONEY_RE = /^\d{1,14}(\.\d{1,2})?$/;
const PCT_RE = /^(\d{1,2}(\.\d{1,4})?|100(\.0{1,4})?)$/;
const isPositiveQty = (q: string): boolean => QTY_RE.test(q) && /[1-9]/.test(q);
const newRequestId = (): string => crypto.randomUUID();

const money = (v: string): string => v;
const effectivePrice = (l: CartLine): string =>
  l.price !== '' && MONEY_RE.test(l.price) ? l.price : l.product.sellingPrice;

export const PosPage = ({
  storeId,
  storeName = '',
  canChangePrice = false,
  canRefund = true,
  canViewBills = true,
  canIssueVoucher = false,
}: {
  storeId: string;
  storeName?: string;
  canChangePrice?: boolean;
  canRefund?: boolean;
  canViewBills?: boolean;
  canIssueVoucher?: boolean;
}) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState('');
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [bank, setBank] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [account, setAccount] = useState('');
  const [customer, setCustomer] = useState<CustomerWithBalance | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerWithBalance[]>([]);
  const [customerMsg, setCustomerMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [returnReceipt, setReturnReceipt] = useState<SaleReturnDetail | null>(null);
  const [lastSale, setLastSale] = useState<SaleDetail | null>(null);
  const [tab, setTab] = useState<Tab>('sales');
  const [salesType, setSalesType] = useState<'SALES' | 'RETURN'>('SALES');
  const [unitType, setUnitType] = useState<'PCS' | 'MTR'>('PCS');
  const [salesman, setSalesman] = useState('');
  const [entryQty, setEntryQty] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryDisc, setEntryDisc] = useState('');
  const [freeItem, setFreeItem] = useState(false);
  const [picked, setPicked] = useState<PosProduct | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState('');
  const [fbrInv, setFbrInv] = useState('');
  const [cnNo, setCnNo] = useState('');
  const [serviceFee, setServiceFee] = useState('');
  const [otherCharges, setOtherCharges] = useState('');
  const [roundNotApply, setRoundNotApply] = useState(true);
  const [dvCode, setDvCode] = useState('');
  const [dv, setDv] = useState<VoucherRecord | null>(null);
  const [cmCode, setCmCode] = useState('');
  const [cm, setCm] = useState<VoucherRecord | null>(null);
  const [voucherMsg, setVoucherMsg] = useState<string | null>(null);
  const [vouchersOpen, setVouchersOpen] = useState<null | 'pick' | 'manage'>(null);
  const [voucherRows, setVoucherRows] = useState<VoucherRecord[]>([]);
  const [issueKind, setIssueKind] = useState<'DISCOUNT' | 'CREDIT_MEMO'>('CREDIT_MEMO');
  const [issueAmount, setIssueAmount] = useState('');
  const [issueCode, setIssueCode] = useState('');
  const [issuedMsg, setIssuedMsg] = useState<string | null>(null);
  const [loyalBills, setLoyalBills] = useState<SaleListResult['items']>([]);
  const [cardNo, setCardNo] = useState('');
  const [approval, setApproval] = useState('');
  const [terminal, setTerminal] = useState('');
  const [billsOpen, setBillsOpen] = useState<null | 'all' | 'today'>(null);
  const [bills, setBills] = useState<SaleListResult['items']>([]);
  const [billQuery, setBillQuery] = useState('');
  const [billMsg, setBillMsg] = useState<string | null>(null);
  const [returnBill, setReturnBill] = useState<SaleDetail | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [partial, setPartial] = useState(true);
  const [returnReason, setReturnReason] = useState('');
  const [returnTender, setReturnTender] = useState<TenderMethod>('CASH');
  const [stockQuery, setStockQuery] = useState('');
  const [stockRows, setStockRows] = useState<PosProduct[]>([]);
  const barcodeRef = useRef<HTMLInputElement>(null);
  // One idempotency key per checkout attempt: a retry after a timeout reuses it, so it can never double-charge.
  const requestId = useRef<string>(newRequestId());
  const inFlight = useRef(false);

  const preview = useMemo(() => {
    if (cart.length === 0) return { ok: true as const, totals: null, lines: [] };
    if (cart.some((l) => !isPositiveQty(l.quantity)))
      return { ok: false as const, message: 'Enter a valid quantity for every item.' };
    if (cart.some((l) => l.price !== '' && !MONEY_RE.test(l.price)))
      return { ok: false as const, message: 'Enter a valid price for every item.' };
    if (cart.some((l) => l.discountPercent !== '' && !PCT_RE.test(l.discountPercent)))
      return { ok: false as const, message: 'Item discount must be a percentage from 0 to 100.' };
    if (cartDiscount !== '' && !PCT_RE.test(cartDiscount))
      return { ok: false as const, message: 'Cart discount must be a percentage from 0 to 100.' };
    try {
      const { lines, totals } = computeSale(
        cart.map((l) => ({
          quantity: l.quantity,
          unitPrice: effectivePrice(l),
          taxRate: l.product.taxRate,
          discountPercent: l.free ? '100' : l.discountPercent || '0',
        })),
        { discountPercent: cartDiscount || '0' },
      );
      return { ok: true as const, totals, lines };
    } catch (err) {
      if (err instanceof SaleMathError) return { ok: false as const, message: err.message };
      throw err;
    }
  }, [cart, cartDiscount]);

  const linesTotal = preview.ok && preview.totals ? preview.totals.grandTotal : '0.00';
  const chargesValid = [serviceFee, otherCharges].every((v) => v === '' || MONEY_RE.test(v));
  const charges = chargesValid
    ? addDecimalStrings(serviceFee || '0', otherCharges || '0', 2)
    : '0.00';
  // Same order as the server: lines + charges, then the discount voucher, then the credit memo, then rounding.
  const afterCharges = addDecimalStrings(linesTotal, charges, 2);
  const useVoucher = (v: VoucherRecord | null, from: string): string =>
    v && compareDecimalStrings(v.balance, from, 2) < 0 ? v.balance : v ? from : '0.00';
  const dvUse = useVoucher(dv, afterCharges);
  const cmUse = useVoucher(cm, subtractDecimalStrings(afterCharges, dvUse, 2));
  const afterVouchers = subtractDecimalStrings(
    subtractDecimalStrings(afterCharges, dvUse, 2),
    cmUse,
    2,
  );
  const rounding = roundNotApply
    ? '0.00'
    : subtractDecimalStrings(roundDecimalString(afterVouchers, 0), afterVouchers, 2);
  const total = addDecimalStrings(afterVouchers, rounding, 2);
  const amounts = [cash, card, bank, account].map((v) => (v === '' ? '0.00' : v));
  const amountsValid = [cash, card, bank, account].every((v) => v === '' || MONEY_RE.test(v));
  const tendered = amountsValid
    ? amounts.reduce((a, b) => addDecimalStrings(a, b, 2), '0.00')
    : '0.00';
  const enough = amountsValid && compareDecimalStrings(tendered, total, 2) >= 0;
  const change = enough ? subtractDecimalStrings(tendered, total, 2) : '0.00';

  const findCustomer = async (e: FormEvent) => {
    e.preventDefault();
    const q = customerQuery.trim();
    if (q.length < 2) return;
    setCustomerMsg(null);
    try {
      const res = await apiRequest<CustomerListResult>(
        `/customers?search=${encodeURIComponent(q)}&isActive=true&pageSize=8`,
      );
      setCustomerResults(res.items);
      if (res.items.length === 0) setCustomerMsg('No matching customer.');
    } catch (err) {
      setCustomerResults([]);
      setCustomerMsg(err instanceof ApiError ? err.message : 'Customer search failed.');
    }
  };

  const pickCustomer = (c: CustomerWithBalance) => {
    setCustomer(c);
    setCustomerResults([]);
    setCustomerQuery('');
    setCustomerName('');
  };

  const clearCustomer = () => {
    setCustomer(null);
    setAccount('');
  };

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const res = await apiRequest<{ items: PosProduct[] }>(
        `/pos/products?storeId=${encodeURIComponent(storeId)}&search=${encodeURIComponent(q)}`,
      );
      // A scanner types the barcode and presses Enter: an exact barcode/SKU hit goes straight into the cart.
      const exact = res.items.find(
        (p) => p.barcodes.includes(q) || p.sku.toLowerCase() === q.toLowerCase(),
      );
      if (exact) {
        addToCart(exact, { qty: entryQty, price: entryPrice, disc: entryDisc, free: freeItem });
        setResults([]);
        setSearch('');
      } else {
        setResults(res.items);
        if (res.items.length === 0) setError('No matching product.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const addToCart = (
    product: PosProduct,
    opts: { qty?: string; price?: string; disc?: string; free?: boolean } = {},
  ) => {
    const qty = opts.qty && isPositiveQty(opts.qty) ? opts.qty : '1';
    setSelected(product.id);
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id && l.free === !!opts.free);
      if (i >= 0) {
        const next = [...prev];
        const cur = next[i]!;
        next[i] = {
          ...cur,
          quantity: isPositiveQty(cur.quantity)
            ? addDecimalStrings(cur.quantity, qty, 3).replace(/\.?0+$/, '')
            : qty,
        };
        return next;
      }
      return [
        ...prev,
        {
          product,
          quantity: qty,
          discountPercent: opts.disc ?? '',
          price: canChangePrice ? (opts.price ?? '') : '',
          salesman,
          free: !!opts.free,
        },
      ];
    });
  };

  const setLine = (id: string, patch: Partial<CartLine>) =>
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  const keyOf = (l: CartLine): string => `${l.product.id}${l.free ? ':free' : ''}`;

  const cardRef = [
    cardNo.trim(),
    approval.trim() ? `A:${approval.trim()}` : '',
    terminal.trim() ? `T:${terminal.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 64);
  const complete = async () => {
    if (inFlight.current || !preview.ok || !chargesValid || cart.length === 0 || !enough) return;
    if (account !== '' && /[1-9]/.test(account) && !customer) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const payments = (
      [
        ['CASH', cash],
        ['CARD', card],
        ['BANK_TRANSFER', bank],
        ['CUSTOMER_CREDIT', account],
      ] as [TenderMethod, string][]
    )
      .filter(([, v]) => v !== '' && /[1-9]/.test(v))
      .map(([method, amount]) => ({
        method,
        amount,
        ...(method === 'CARD' && cardRef ? { reference: cardRef } : {}),
      }));
    try {
      const sale = await apiRequest<SaleDetail>('/sales', {
        method: 'POST',
        body: {
          clientRequestId: requestId.current,
          storeId,
          items: cart.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            ...(l.salesman.trim() ? { salesman: l.salesman.trim() } : {}),
            ...(l.price !== '' && l.price !== l.product.sellingPrice ? { unitPrice: l.price } : {}),
            ...(l.free
              ? { discountPercent: '100' }
              : l.discountPercent && /[1-9]/.test(l.discountPercent)
                ? { discountPercent: l.discountPercent }
                : {}),
          })),
          ...(cartDiscount && /[1-9]/.test(cartDiscount) ? { discountPercent: cartDiscount } : {}),
          payments,
          ...(orderRef.trim() ? { orderRef: orderRef.trim() } : {}),
          ...(fbrInv.trim() ? { fbrInvoiceNo: fbrInv.trim() } : {}),
          ...(cnNo.trim() ? { creditNoteRef: cnNo.trim() } : {}),
          ...(/[1-9]/.test(serviceFee) ? { serviceFee } : {}),
          ...(/[1-9]/.test(otherCharges) ? { otherCharges } : {}),
          ...(!roundNotApply ? { roundToWhole: true } : {}),
          ...(dv ? { discountVoucherCode: dv.code } : {}),
          ...(cm ? { creditMemoCode: cm.code } : {}),
          ...(customer ? { customerId: customer.id } : {}),
          ...(!customer && customerName.trim() ? { customerName: customerName.trim() } : {}),
        },
      });
      // Sale committed: reset for the next customer and use a NEW key.
      setReceipt(sale);
      setLastSale(sale);
      setCart([]);
      setSelected(null);
      setOrderRef('');
      setFbrInv('');
      setCnNo('');
      setServiceFee('');
      setOtherCharges('');
      setDv(null);
      setDvCode('');
      setCm(null);
      setCmCode('');
      setVoucherMsg(null);
      setCardNo('');
      setApproval('');
      setTerminal('');
      setCartDiscount('');
      setCash('');
      setCard('');
      setBank('');
      setAccount('');
      setCustomer(null);
      setCustomerName('');
      setResults([]);
      requestId.current = newRequestId();
    } catch (err) {
      // The key is kept on failure so "Complete sale" can be pressed again safely.
      setError(err instanceof ApiError ? err.message : 'Could not complete the sale. Try again.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const loadBills = async (mode: 'all' | 'today', q: string) => {
    setBillsOpen(mode);
    setBillMsg(null);
    try {
      const qs = new URLSearchParams({ pageSize: '30' });
      if (mode === 'today') qs.set('from', startOfToday());
      if (q.trim()) qs.set('search', q.trim());
      const res = await apiRequest<SaleListResult>(`/sales?${qs.toString()}`);
      setBills(res.items);
      if (res.items.length === 0) setBillMsg('No bills found.');
    } catch (err) {
      setBills([]);
      setBillMsg(err instanceof ApiError ? err.message : 'Could not load bills.');
    }
  };

  const pickBill = async (id: string) => {
    try {
      const sale = await apiRequest<SaleDetail>(`/sales/${id}`);
      setBillsOpen(null);
      if (salesType === 'RETURN') {
        setReturnBill(sale);
        setPartial(true);
        setReturnQty({});
        setError(null);
      } else {
        setReceipt(sale);
      }
    } catch (err) {
      setBillMsg(err instanceof ApiError ? err.message : 'Could not open the bill.');
    }
  };

  const remaining = (it: SaleDetail['items'][number]): string =>
    subtractDecimalStrings(it.quantity, it.returnedQuantity, 3);
  const returnLines = returnBill
    ? returnBill.items
        .map((it) => ({
          it,
          qty: partial ? (returnQty[it.id] ?? '') : remaining(it),
        }))
        .filter((r) => r.qty !== '' && isPositiveQty(r.qty))
    : [];
  const returnInvalid = returnLines.some(
    (r) => compareDecimalStrings(r.qty, remaining(r.it), 3) > 0,
  );

  const processReturn = async () => {
    if (!returnBill || returnLines.length === 0 || returnInvalid || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const ret = await apiRequest<SaleReturnDetail>(`/sales/${returnBill.id}/returns`, {
        method: 'POST',
        body: {
          items: returnLines.map((r) => ({ saleItemId: r.it.id, quantity: r.qty })),
          refundMethod: returnTender,
          ...(returnReason.trim() ? { reason: returnReason.trim() } : {}),
        },
      });
      setReturnReceipt(ret);
      setReturnBill(null);
      setReturnQty({});
      setReturnReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not process the return.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const searchStock = async (e: FormEvent) => {
    e.preventDefault();
    const q = stockQuery.trim();
    if (!q) return;
    try {
      const res = await apiRequest<{ items: PosProduct[] }>(
        `/pos/products?storeId=${encodeURIComponent(storeId)}&search=${encodeURIComponent(q)}`,
      );
      setStockRows(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stock search failed.');
    }
  };

  const checkVoucher = async (kind: 'DISCOUNT' | 'CREDIT_MEMO', raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    setVoucherMsg(null);
    try {
      const v = await apiRequest<VoucherRecord>(`/vouchers/${encodeURIComponent(code)}`);
      const label = kind === 'DISCOUNT' ? 'Discount voucher' : 'Credit memo';
      if (v.kind !== kind) throw new Error(`${code} is not a ${label.toLowerCase()}.`);
      if (v.status !== 'ACTIVE') throw new Error(`${label} ${code} is ${v.status.toLowerCase()}.`);
      if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) {
        throw new Error(`${label} ${code} has expired.`);
      }
      if (kind === 'DISCOUNT') setDv(v);
      else setCm(v);
      setVoucherMsg(`${label} ${v.code}: ${v.balance} available.`);
    } catch (err) {
      if (kind === 'DISCOUNT') setDv(null);
      else setCm(null);
      setVoucherMsg(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not check the voucher.',
      );
    }
  };

  const loadVouchers = async (mode: 'pick' | 'manage') => {
    setVouchersOpen(mode);
    setIssuedMsg(null);
    try {
      const res = await apiRequest<VoucherListResult>(
        `/vouchers?pageSize=30${mode === 'pick' ? '&status=ACTIVE&kind=CREDIT_MEMO' : ''}`,
      );
      setVoucherRows(res.items);
    } catch (err) {
      setVoucherRows([]);
      setIssuedMsg(err instanceof ApiError ? err.message : 'Could not load vouchers.');
    }
  };

  const issueVoucher = async () => {
    if (!MONEY_RE.test(issueAmount) || !/[1-9]/.test(issueAmount)) {
      setIssuedMsg('Enter an amount greater than zero.');
      return;
    }
    try {
      const v = await apiRequest<VoucherRecord>('/vouchers', {
        method: 'POST',
        body: {
          kind: issueKind,
          amount: issueAmount,
          ...(issueCode.trim() ? { code: issueCode.trim() } : {}),
        },
      });
      setIssuedMsg(`Issued ${v.code} for ${v.amount}.`);
      setIssueAmount('');
      setIssueCode('');
      void loadVouchers('manage');
    } catch (err) {
      setIssuedMsg(err instanceof ApiError ? err.message : 'Could not issue the voucher.');
    }
  };

  const clearAll = () => {
    setCart([]);
    setSelected(null);
    setCartDiscount('');
    setCash('');
    setCard('');
    setBank('');
    setAccount('');
    setCustomer(null);
    setCustomerName('');
    setResults([]);
    setError(null);
    setOrderRef('');
    setFbrInv('');
    setCnNo('');
    setServiceFee('');
    setOtherCharges('');
    setDv(null);
    setDvCode('');
    setCm(null);
    setCmCode('');
    setVoucherMsg(null);
    setReturnBill(null);
    requestId.current = newRequestId();
  };

  const undoLast = () =>
    setCart((prev) => {
      const next = prev.slice(0, -1);
      setSelected(next.length > 0 ? keyOf(next[next.length - 1]!).replace(':free', '') : null);
      return next;
    });

  const updateSelectedQty = () => {
    if (!selected || !isPositiveQty(entryQty)) return;
    setCart((prev) =>
      prev.map((l) => (l.product.id === selected ? { ...l, quantity: entryQty } : l)),
    );
  };

  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setTab('sales');
        barcodeRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setTab('sales');
      } else if (e.key === 'F2') {
        e.preventDefault();
        setTab('stock');
      } else if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void completeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const today = new Date().toLocaleDateString();
  const itemCount = cart.reduce(
    (n, l) => (isPositiveQty(l.quantity) ? addDecimalStrings(n, l.quantity, 3) : n),
    '0',
  );
  const tb =
    'focus-ring rounded border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  const needs = (what: string): string => `Needs ${what}, which is not connected to this system.`;
  const mini = 'w-full px-2 py-1 text-xs';
  const isReturn = salesType === 'RETURN';

  return (
    <div className="space-y-3" data-testid="pos-screen">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="POS actions">
        <button
          type="button"
          className={tb}
          disabled={!canViewBills}
          onClick={() => void loadVouchers('manage')}
        >
          Vouchers
        </button>
        <button type="button" className={tb} disabled title={needs('delivery-courier integration')}>
          Print Airway Bill
        </button>
        <button type="button" className={tb} disabled title={needs('an FBR POS connection')}>
          Post Fbr
        </button>
        <button type="button" className={tb} disabled title={needs('an FBR POS connection')}>
          Repost
        </button>
        <button
          type="button"
          className={tb}
          title="Put the unpaid balance on the chosen customer's account"
          onClick={() => {
            if (!customer) {
              setCustomerMsg('Find and choose a customer first, then use On Account.');
              return;
            }
            const others = [cash, card, bank]
              .map((v) => (v === '' ? '0.00' : v))
              .reduce((a, b) => addDecimalStrings(a, b, 2), '0.00');
            const rest = subtractDecimalStrings(total, others, 2);
            setAccount(rest.startsWith('-') || rest === '0.00' ? '' : rest);
          }}
        >
          On Account
        </button>
        <button
          type="button"
          className={tb}
          aria-label="Add item (F1)"
          onClick={() => {
            setTab('sales');
            barcodeRef.current?.focus();
          }}
        >
          Add <kbd>F1</kbd>
        </button>
        <button
          type="button"
          className={tb}
          aria-label="Print last bill"
          disabled={!lastSale}
          onClick={() => lastSale && setReceipt(lastSale)}
        >
          Print
        </button>
        <button
          type="button"
          className={tb}
          aria-label="Save (Alt+S)"
          disabled={submitting || cart.length === 0 || !preview.ok || !enough || isReturn}
          onClick={() => void complete()}
        >
          Save <kbd>ALT S</kbd>
        </button>
        <button
          type="button"
          className={tb}
          aria-label="Undo last item"
          disabled={cart.length === 0}
          onClick={undoLast}
        >
          Undo
        </button>
        <button type="button" className={tb} aria-label="Close bill" onClick={clearAll}>
          Close
        </button>
      </div>

      {/* Bill header */}
      <Card>
        <CardBody className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="pos-billno">Bill No</Label>
            <div className="flex gap-1">
              <Input id="pos-billno" className={mini} readOnly value="Auto on save" />
              <button
                type="button"
                className={tb}
                disabled={!canViewBills}
                onClick={() => void loadBills('all', billQuery)}
              >
                Bills
              </button>
              <button
                type="button"
                className={tb}
                disabled={!canViewBills}
                onClick={() => void loadBills('today', '')}
              >
                Today
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="pos-date">Bill Date</Label>
            <Input id="pos-date" className={mini} readOnly value={today} />
          </div>
          <div>
            <Label htmlFor="pos-shop">Shop</Label>
            <Input id="pos-shop" className={mini} readOnly value={storeName || storeId} />
          </div>
          <div>
            <Label htmlFor="pos-sales-type">Sales Type</Label>
            <select
              id="pos-sales-type"
              className={`${mini} rounded-md border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800`}
              value={salesType}
              onChange={(e) => {
                setSalesType(e.target.value as 'SALES' | 'RETURN');
                setError(null);
              }}
            >
              <option value="SALES">Sales</option>
              <option value="RETURN" disabled={!canRefund}>
                Sales Return
              </option>
            </select>
          </div>
          <div>
            <Label htmlFor="pos-fbr">FBR Inv #</Label>
            <Input
              id="pos-fbr"
              className={mini}
              value={fbrInv}
              maxLength={40}
              onChange={(e) => setFbrInv(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pos-orderref">Order Ref #</Label>
            <Input
              id="pos-orderref"
              className={mini}
              value={orderRef}
              maxLength={40}
              onChange={(e) => setOrderRef(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pos-cn">C.N #</Label>
            <Input
              id="pos-cn"
              className={mini}
              value={cnNo}
              maxLength={40}
              onChange={(e) => setCnNo(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pos-unit">Unit Type</Label>
            <select
              id="pos-unit"
              className={`${mini} rounded-md border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800`}
              value={unitType}
              onChange={(e) => setUnitType(e.target.value as 'PCS' | 'MTR')}
            >
              <option value="PCS">PCS</option>
              <option value="MTR">MTR</option>
            </select>
          </div>
        </CardBody>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="POS sections">
        {(
          [
            ['sales', 'Sales - F4', true],
            ['stock', 'Check Stock - F2', true],
            ['loyal', 'Loyal Customer', true],
          ] as [Tab, string, boolean][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${tb} ${tab === key ? '!bg-brand-600 !text-white' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        {['Alteration - F11', 'Shopping Bags', 'Keenu Pay Log'].map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            className={tb}
            disabled
            title="Not available in this version."
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'loyal' ? (
        <Card>
          <CardBody className="space-y-3">
            {customer ? (
              <>
                <p className="text-sm" data-testid="loyal-summary">
                  <strong>{customer.name}</strong> · owes {customer.balance} · credit limit{' '}
                  {customer.creditLimit && customer.creditLimit !== '0.00'
                    ? customer.creditLimit
                    : 'none'}
                </p>
                <button
                  type="button"
                  className={tb}
                  onClick={() => {
                    void (async () => {
                      try {
                        const res = await apiRequest<SaleListResult>(
                          `/sales?customerId=${encodeURIComponent(customer.id)}&pageSize=10`,
                        );
                        setLoyalBills(res.items);
                      } catch {
                        setLoyalBills([]);
                      }
                    })();
                  }}
                >
                  Show purchases
                </button>
                <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  {loyalBills.map((b) => (
                    <li key={b.id} className="flex justify-between py-1">
                      <span>
                        {b.invoiceNo} · {new Date(b.soldAt).toLocaleDateString()}
                      </span>
                      <span>{b.grandTotal}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Choose a customer on the Sales tab (Find a customer) to see their account here.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'loyal' ? null : tab === 'stock' ? (
        <Card>
          <CardBody className="space-y-2">
            <form onSubmit={(e) => void searchStock(e)} className="flex gap-2" role="search">
              <Input
                aria-label="Check stock"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder="Barcode, SKU or name"
              />
              <Button type="submit">
                <Search size={16} /> Check
              </Button>
            </form>
            <table className="w-full text-sm" aria-label="Stock">
              <thead>
                <tr className="text-left text-slate-500">
                  <th>Item</th>
                  <th>SKU</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">In stock</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((p) => (
                  <tr key={p.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td>{p.name}</td>
                    <td>{p.sku}</td>
                    <td className="text-right">{p.sellingPrice}</td>
                    <td className="text-right">{p.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : isReturn ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">Sales return</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {!returnBill ? (
              <div className="flex items-center gap-2 text-sm">
                <span>Pick the bill the goods were sold on.</span>
                <button
                  type="button"
                  className={tb}
                  onClick={() => void loadBills('all', billQuery)}
                >
                  Pick bill
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm">
                  Return # <strong>Auto on save</strong> · Bill{' '}
                  <strong>{returnBill.invoiceNo}</strong> ({returnBill.status})
                </p>
                {returnBill.returns.length > 0 ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    Earlier returns:
                    {returnBill.returns.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={tb}
                        onClick={() => setReturnReceipt(r)}
                      >
                        {r.returnNo}
                      </button>
                    ))}
                  </p>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={partial}
                    onChange={(e) => setPartial(e.target.checked)}
                  />
                  Partial Return
                </label>
                <table className="w-full text-sm" aria-label="Return items">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th>Item</th>
                      <th className="text-right">Sold</th>
                      <th className="text-right">Returned</th>
                      <th className="text-right">Return qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnBill.items.map((it) => (
                      <tr key={it.id} className="border-t border-slate-200 dark:border-slate-800">
                        <td>{it.productName}</td>
                        <td className="text-right">{it.quantity}</td>
                        <td className="text-right">{it.returnedQuantity}</td>
                        <td className="text-right">
                          <Input
                            aria-label={`Return quantity ${it.productName}`}
                            className="w-24 text-right"
                            disabled={!partial}
                            value={partial ? (returnQty[it.id] ?? '') : remaining(it)}
                            onChange={(e) =>
                              setReturnQty((p) => ({ ...p, [it.id]: e.target.value }))
                            }
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {returnInvalid ? (
                  <p className="text-sm text-red-600">
                    You cannot return more than what is left on the bill.
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pos-ret-reason">Return Reason</Label>
                    <Input
                      id="pos-ret-reason"
                      value={returnReason}
                      maxLength={300}
                      onChange={(e) => setReturnReason(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pos-ret-tender">Return Tender</Label>
                    <select
                      id="pos-ret-tender"
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                      value={returnTender}
                      onChange={(e) => setReturnTender(e.target.value as TenderMethod)}
                    >
                      {TENDERS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={submitting || returnLines.length === 0 || returnInvalid}
                    onClick={() => void processReturn()}
                  >
                    {submitting ? 'Processing…' : 'Process return'}
                  </Button>
                  <Button variant="secondary" onClick={() => setReturnBill(null)}>
                    Cancel return
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <Card>
              <CardBody>
                <form
                  onSubmit={(e) => void runSearch(e)}
                  className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
                  role="search"
                >
                  <div>
                    <Label htmlFor="pos-salesman">Sales Man</Label>
                    <Input
                      id="pos-salesman"
                      className={mini}
                      value={salesman}
                      maxLength={40}
                      onChange={(e) => setSalesman(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="pos-search">BarCode</Label>
                    <div className="flex gap-1">
                      <Input
                        id="pos-search"
                        ref={barcodeRef}
                        aria-label="Scan barcode or search product"
                        className={mini}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                        placeholder="Barcode, SKU or name"
                      />
                      <button type="submit" className={tb} disabled={searching}>
                        {searching ? 'Searching…' : 'Search'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="pos-eqty">Quantity</Label>
                    <Input
                      id="pos-eqty"
                      className={mini}
                      value={entryQty}
                      inputMode={unitType === 'MTR' ? 'decimal' : 'numeric'}
                      onChange={(e) => setEntryQty(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pos-eprice">Price</Label>
                    <Input
                      id="pos-eprice"
                      className={mini}
                      value={entryPrice}
                      disabled={!canChangePrice}
                      title={canChangePrice ? undefined : 'You do not have the price-change right.'}
                      placeholder={picked?.sellingPrice ?? 'catalogue'}
                      onChange={(e) => setEntryPrice(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pos-edesc">Description</Label>
                    <Input id="pos-edesc" className={mini} readOnly value={picked?.name ?? ''} />
                  </div>
                  <div>
                    <Label htmlFor="pos-egst">GST %</Label>
                    <Input id="pos-egst" className={mini} readOnly value={picked?.taxRate ?? ''} />
                  </div>
                  <div>
                    <Label htmlFor="pos-edisc">Disc %</Label>
                    <Input
                      id="pos-edisc"
                      className={mini}
                      value={entryDisc}
                      onChange={(e) => setEntryDisc(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                  <label className="flex items-end gap-1 pb-1">
                    <input
                      type="checkbox"
                      checked={freeItem}
                      onChange={(e) => setFreeItem(e.target.checked)}
                    />
                    Free Item
                  </label>
                  <div className="flex items-end gap-1">
                    <button
                      type="button"
                      className={tb}
                      disabled={!picked}
                      onClick={() => {
                        if (!picked) return;
                        addToCart(picked, {
                          qty: entryQty,
                          price: entryPrice,
                          disc: entryDisc,
                          free: freeItem,
                        });
                        setPicked(null);
                        setEntryPrice('');
                        setEntryDisc('');
                      }}
                    >
                      Add Item
                    </button>
                    <button
                      type="button"
                      className={tb}
                      disabled={!selected || !isPositiveQty(entryQty)}
                      onClick={updateSelectedQty}
                    >
                      Upd Qty
                    </button>
                    <button
                      type="button"
                      className={tb}
                      disabled
                      title="Bundles are not set up in this version."
                    >
                      Bundle
                    </button>
                  </div>
                </form>
                {results.length > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                    {results.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-medium">{p.name}</span>{' '}
                          <span className="text-slate-500">{p.sku}</span>
                          <span className="ml-2 text-slate-500">in stock: {p.stock}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          {money(p.sellingPrice)}
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setPicked(p);
                              addToCart(p, {
                                qty: entryQty,
                                price: entryPrice,
                                disc: entryDisc,
                                free: freeItem,
                              });
                              setResults([]);
                              setSearch('');
                            }}
                            aria-label={`Add ${p.name}`}
                          >
                            <Plus size={14} /> Add
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardBody className="overflow-x-auto">
                {cart.length === 0 ? (
                  <EmptyState
                    title="The cart is empty"
                    description="Scan or search a product to start a sale."
                  />
                ) : (
                  <table className="w-full text-xs" aria-label="Bill items">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1">Barcode</th>
                        <th>Description</th>
                        <th>Salesman</th>
                        <th>Qty</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Gross Sales</th>
                        <th>Disc %</th>
                        <th className="text-right">Disc</th>
                        <th className="text-right">GST</th>
                        <th className="text-right">Net Sale</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((l, i) => {
                        const c = preview.ok ? preview.lines[i] : undefined;
                        return (
                          <tr
                            key={keyOf(l)}
                            aria-selected={selected === l.product.id}
                            onClick={() => setSelected(l.product.id)}
                            className={`border-t border-slate-200 dark:border-slate-800 ${
                              selected === l.product.id ? 'bg-brand-50 dark:bg-slate-800' : ''
                            }`}
                          >
                            <td className="py-1">{l.product.barcodes[0] ?? l.product.sku}</td>
                            <td>
                              {l.product.name}
                              {l.free ? (
                                <span className="ml-1 text-emerald-600">(free)</span>
                              ) : null}
                              <div className="text-slate-500">stock {l.product.stock}</div>
                            </td>
                            <td>{l.salesman || '—'}</td>
                            <td>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="!px-1 !py-0.5"
                                  aria-label={`Decrease ${l.product.name}`}
                                  onClick={() =>
                                    isPositiveQty(l.quantity) &&
                                    compareDecimalStrings(l.quantity, '1', 3) > 0 &&
                                    setLine(l.product.id, {
                                      quantity: subtractDecimalStrings(l.quantity, '1', 3).replace(
                                        /\.?0+$/,
                                        '',
                                      ),
                                    })
                                  }
                                >
                                  <Minus size={12} />
                                </Button>
                                <Input
                                  aria-label={`Quantity ${l.product.name}`}
                                  className="w-16 px-1 py-0.5 text-xs"
                                  value={l.quantity}
                                  onChange={(e) =>
                                    setLine(l.product.id, { quantity: e.target.value })
                                  }
                                  inputMode="decimal"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="!px-1 !py-0.5"
                                  aria-label={`Increase ${l.product.name}`}
                                  onClick={() => addToCart(l.product, { free: l.free })}
                                >
                                  <Plus size={12} />
                                </Button>
                              </div>
                            </td>
                            <td className="text-right">{effectivePrice(l)}</td>
                            <td className="text-right">{c?.grossAmount ?? '—'}</td>
                            <td>
                              <Input
                                aria-label={`Discount percent ${l.product.name}`}
                                className="w-14 px-1 py-0.5 text-xs"
                                disabled={l.free}
                                value={l.free ? '100' : l.discountPercent}
                                onChange={(e) =>
                                  setLine(l.product.id, { discountPercent: e.target.value })
                                }
                                inputMode="decimal"
                                placeholder="0"
                              />
                            </td>
                            <td className="text-right">{c?.discountAmount ?? '—'}</td>
                            <td className="text-right">{c?.taxAmount ?? '—'}</td>
                            <td className="text-right font-medium">{c?.lineTotal ?? '—'}</td>
                            <td className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                className="!px-1 !py-0.5"
                                aria-label={`Remove ${l.product.name}`}
                                onClick={() =>
                                  setCart((prev) => prev.filter((x) => keyOf(x) !== keyOf(l)))
                                }
                              >
                                <Trash2 size={12} />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {preview.ok && preview.totals ? (
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">
                          <td colSpan={3}>Total</td>
                          <td>{itemCount}</td>
                          <td />
                          <td className="text-right">{preview.totals.subtotal}</td>
                          <td />
                          <td className="text-right">{preview.totals.itemDiscountTotal}</td>
                          <td className="text-right">{preview.totals.taxTotal}</td>
                          <td className="text-right">{preview.totals.grandTotal}</td>
                          <td />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold">Checkout</h2>
              </CardHeader>
              <CardBody className="space-y-3">
                {!preview.ok ? <ErrorBanner message={preview.message} /> : null}
                <div>
                  <Label htmlFor="pos-cart-discount">Cart discount %</Label>
                  <Input
                    id="pos-cart-discount"
                    value={cartDiscount}
                    onChange={(e) => setCartDiscount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
                <dl className="space-y-1 text-sm" aria-label="Totals">
                  {preview.ok && preview.totals ? (
                    <>
                      <Row label="Subtotal" value={preview.totals.subtotal} />
                      {preview.totals.itemDiscountTotal !== '0.00' ? (
                        <Row
                          label="Item discounts"
                          value={`-${preview.totals.itemDiscountTotal}`}
                        />
                      ) : null}
                      {preview.totals.cartDiscountAmount !== '0.00' ? (
                        <Row
                          label="Cart discount"
                          value={`-${preview.totals.cartDiscountAmount}`}
                        />
                      ) : null}
                      {preview.totals.taxTotal !== '0.00' ? (
                        <Row label="Tax" value={preview.totals.taxTotal} />
                      ) : null}
                    </>
                  ) : null}
                  {charges !== '0.00' ? <Row label="Charges" value={charges} /> : null}
                  {dvUse !== '0.00' ? <Row label="Disc Voucher" value={`-${dvUse}`} /> : null}
                  {cmUse !== '0.00' ? <Row label="Credit Memo" value={`-${cmUse}`} /> : null}
                  {rounding !== '0.00' ? <Row label="Rounding" value={rounding} /> : null}
                  <Row label="# of Items" value={itemCount} />
                  <div className="flex justify-between border-t border-slate-300 pt-2 text-lg font-bold dark:border-slate-700">
                    <dt>Net Receive Amount</dt>
                    <dd data-testid="grand-total">{total}</dd>
                  </div>
                </dl>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Label htmlFor="pos-service-fee">Service Fee</Label>
                    <Input
                      id="pos-service-fee"
                      className={mini}
                      value={serviceFee}
                      inputMode="decimal"
                      placeholder="0.00"
                      onChange={(e) => setServiceFee(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pos-other-charges">Add Other Charges</Label>
                    <Input
                      id="pos-other-charges"
                      className={mini}
                      value={otherCharges}
                      inputMode="decimal"
                      placeholder="0.00"
                      onChange={(e) => setOtherCharges(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pos-dv">Disc Voucher #</Label>
                    <div className="flex gap-1">
                      <Input
                        id="pos-dv"
                        className={mini}
                        value={dvCode}
                        onChange={(e) => {
                          setDvCode(e.target.value);
                          setDv(null);
                        }}
                      />
                      <button
                        type="button"
                        className={tb}
                        disabled={!dvCode.trim()}
                        onClick={() => void checkVoucher('DISCOUNT', dvCode)}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="pos-cm">Credit Memo #</Label>
                    <div className="flex gap-1">
                      <Input
                        id="pos-cm"
                        className={mini}
                        value={cmCode}
                        onChange={(e) => {
                          setCmCode(e.target.value);
                          setCm(null);
                        }}
                      />
                      <button
                        type="button"
                        className={tb}
                        disabled={!cmCode.trim()}
                        onClick={() => void checkVoucher('CREDIT_MEMO', cmCode)}
                      >
                        Check
                      </button>
                      <button
                        type="button"
                        className={tb}
                        onClick={() => void loadVouchers('pick')}
                      >
                        Pick
                      </button>
                    </div>
                  </div>
                  <label className="col-span-2 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={roundNotApply}
                      onChange={(e) => setRoundNotApply(e.target.checked)}
                    />
                    Round Not Apply
                  </label>
                </div>
                {voucherMsg ? (
                  <p
                    className="text-xs text-slate-600 dark:text-slate-300"
                    data-testid="voucher-msg"
                  >
                    {voucherMsg}
                  </p>
                ) : null}
                {!chargesValid ? (
                  <p className="text-xs text-red-600">Charges must be plain amounts like 25.00.</p>
                ) : null}

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Payment</legend>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="pay-cash">Cash</Label>
                      <Input
                        id="pay-cash"
                        value={cash}
                        onChange={(e) => setCash(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="pay-card">Card</Label>
                      <Input
                        id="pay-card"
                        value={card}
                        onChange={(e) => setCard(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="pay-bank">Bank</Label>
                      <Input
                        id="pay-bank"
                        value={bank}
                        onChange={(e) => setBank(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <Label htmlFor="pos-cardno">Card #</Label>
                      <Input
                        id="pos-cardno"
                        className={mini}
                        value={cardNo}
                        maxLength={24}
                        onChange={(e) => setCardNo(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pos-approval">Approval</Label>
                      <Input
                        id="pos-approval"
                        className={mini}
                        value={approval}
                        maxLength={16}
                        onChange={(e) => setApproval(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pos-terminal">Terminal</Label>
                      <div className="flex gap-1">
                        <Input
                          id="pos-terminal"
                          className={mini}
                          value={terminal}
                          maxLength={16}
                          onChange={(e) => setTerminal(e.target.value)}
                        />
                        <button
                          type="button"
                          className={tb}
                          onClick={() => {
                            setCardNo('');
                            setApproval('');
                            setTerminal('');
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                  {customer ? (
                    <div>
                      <Label htmlFor="pay-account">On account (credit)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="pay-account"
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={cart.length === 0 || !preview.ok || !amountsValid}
                          onClick={() => {
                            const others = [cash, card, bank]
                              .map((v) => (v === '' ? '0.00' : v))
                              .reduce((a, b) => addDecimalStrings(a, b, 2), '0.00');
                            const rest = subtractDecimalStrings(total, others, 2);
                            setAccount(rest.startsWith('-') || rest === '0.00' ? '' : rest);
                          }}
                        >
                          Rest on account
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={cart.length === 0 || !preview.ok}
                    onClick={() => {
                      setCash(total);
                      setCard('');
                      setBank('');
                      setAccount('');
                    }}
                  >
                    Exact cash
                  </Button>
                  <p className="text-sm" data-testid="change-due">
                    {enough ? (
                      <>
                        Change due: <strong>{change}</strong>
                      </>
                    ) : (
                      <span className="text-slate-500">
                        Tendered {tendered} of {total}
                      </span>
                    )}
                  </p>
                </fieldset>

                <div className="space-y-2">
                  {customer ? (
                    <div
                      className="flex items-center justify-between rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700"
                      data-testid="pos-customer-chip"
                    >
                      <span>
                        <strong>{customer.name}</strong>
                        <span className="ml-2 text-xs text-slate-500">
                          owes {customer.balance} · limit{' '}
                          {customer.creditLimit && customer.creditLimit !== '0.00'
                            ? customer.creditLimit
                            : 'none'}
                        </span>
                      </span>
                      <Button type="button" variant="ghost" onClick={clearCustomer}>
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => void findCustomer(e)}
                      className="space-y-1"
                      role="search"
                      aria-label="Find customer"
                    >
                      <Label htmlFor="pos-customer-find">
                        Find a customer (for sales on account)
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="pos-customer-find"
                          value={customerQuery}
                          onChange={(e) => setCustomerQuery(e.target.value)}
                          placeholder="Name or phone"
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={customerQuery.trim().length < 2}
                        >
                          Find
                        </Button>
                      </div>
                      {customerMsg ? <p className="text-xs text-slate-500">{customerMsg}</p> : null}
                      {customerResults.length > 0 ? (
                        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                          {customerResults.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                className="flex w-full justify-between px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                                onClick={() => pickCustomer(c)}
                              >
                                <span>{c.name}</span>
                                <span className="text-xs text-slate-500">owes {c.balance}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </form>
                  )}
                </div>

                {!customer ? (
                  <div>
                    <Label htmlFor="pos-customer">Customer name (optional)</Label>
                    <Input
                      id="pos-customer"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      maxLength={120}
                    />
                  </div>
                ) : null}

                <Button
                  className="w-full"
                  disabled={
                    submitting || cart.length === 0 || !preview.ok || !chargesValid || !enough
                  }
                  onClick={() => void complete()}
                >
                  {submitting ? 'Completing…' : 'Complete sale'}
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {vouchersOpen ? (
        <div
          role="dialog"
          aria-label="Vouchers"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-h-[80vh] w-full max-w-xl space-y-3 overflow-auto rounded-lg bg-white p-4 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {vouchersOpen === 'pick' ? 'Pick a credit memo' : 'Vouchers and credit memos'}
              </h2>
              <Button
                variant="ghost"
                aria-label="Close vouchers"
                onClick={() => setVouchersOpen(null)}
              >
                ✕
              </Button>
            </div>
            {vouchersOpen === 'manage' && canIssueVoucher ? (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <Label htmlFor="iv-kind">Type</Label>
                  <select
                    id="iv-kind"
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-800"
                    value={issueKind}
                    onChange={(e) => setIssueKind(e.target.value as 'DISCOUNT' | 'CREDIT_MEMO')}
                  >
                    <option value="CREDIT_MEMO">Credit memo</option>
                    <option value="DISCOUNT">Discount voucher</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="iv-amount">Amount</Label>
                  <Input
                    id="iv-amount"
                    value={issueAmount}
                    inputMode="decimal"
                    onChange={(e) => setIssueAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="iv-code">Code (optional)</Label>
                  <Input
                    id="iv-code"
                    value={issueCode}
                    maxLength={32}
                    onChange={(e) => setIssueCode(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={() => void issueVoucher()}>Issue</Button>
                </div>
              </div>
            ) : null}
            {issuedMsg ? <p className="text-sm text-slate-600">{issuedMsg}</p> : null}
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {voucherRows.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      if (vouchersOpen === 'pick') {
                        setCmCode(v.code);
                        void checkVoucher('CREDIT_MEMO', v.code);
                        setVouchersOpen(null);
                      }
                    }}
                  >
                    <span>
                      <strong>{v.code}</strong> ·{' '}
                      {v.kind === 'DISCOUNT' ? 'Discount voucher' : 'Credit memo'}
                    </span>
                    <span>
                      {v.balance} of {v.amount} · {v.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {billsOpen ? (
        <div
          role="dialog"
          aria-label="Bills"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="max-h-[80vh] w-full max-w-2xl space-y-3 overflow-auto rounded-lg bg-white p-4 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {billsOpen === 'today' ? "Today's bills" : 'Bills'}
              </h2>
              <Button variant="ghost" aria-label="Close bills" onClick={() => setBillsOpen(null)}>
                ✕
              </Button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void loadBills(billsOpen, billQuery);
              }}
            >
              <Input
                aria-label="Find bill"
                value={billQuery}
                onChange={(e) => setBillQuery(e.target.value)}
                placeholder="Bill number or customer"
              />
              <Button type="submit">Find</Button>
            </form>
            {billMsg ? <p className="text-sm text-slate-500">{billMsg}</p> : null}
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {bills.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => void pickBill(b.id)}
                  >
                    <span>
                      <strong>{b.invoiceNo}</strong> · {b.customerName ?? 'Walk-in'} ·{' '}
                      {new Date(b.soldAt).toLocaleString()}
                    </span>
                    <span>
                      {b.grandTotal} · {b.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <ReceiptModal
          basePath={`/sales/${receipt.id}`}
          number={receipt.invoiceNo}
          onClose={() => setReceipt(null)}
        />
      ) : null}
      {returnReceipt ? (
        <ReceiptModal
          basePath={`/sale-returns/${returnReceipt.id}`}
          number={returnReceipt.returnNo}
          onClose={() => setReturnReceipt(null)}
        />
      ) : null}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
