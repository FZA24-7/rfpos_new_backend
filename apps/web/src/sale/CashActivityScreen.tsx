import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  FolderOpen,
  LogOut,
  Pencil,
  Printer,
  Receipt,
  RefreshCw,
  Save,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import {
  DeskInput,
  DeskModal,
  DeskSelect,
  DeskWindow,
  InlineMessage,
  LookupButton,
  NumBox,
  Row,
  SmallButton,
  ToolButton,
} from './DeskWindow.js';
import { DocPreview } from './DocPreview.js';
import {
  cleanAmount,
  errText,
  fmt,
  fromCents,
  toCents,
  toNumberString,
  useLookups,
  ymdDisplay,
} from './deskApi.js';
import type { Lookups } from './deskApi.js';
import { ShopPicker } from './ShopPicker.js';

interface ExpenseLine {
  head: string;
  description: string;
  amount: string;
}
interface ReceiptLine {
  head: string;
  amount: string;
}
interface TransferLine {
  type: string;
  remarks: string;
  amount: string;
}
interface TerminalLine {
  terminal: string;
  gtech: string;
  settlement: string;
  batch: string;
}
interface SheetView {
  storeId: string;
  date: string;
  saved: boolean;
  closed: boolean;
  voucherNo: string | null;
  openingPettyCash: string;
  receivePettyCash: string;
  creditCardSales: string;
  onAccountSales: string;
  cashSales: string;
  redemptionAmount: string;
  totalSales: string;
  openingCash: string;
  expenseLines: ExpenseLine[];
  receiptLines: ReceiptLine[];
  transferLines: TransferLine[];
  terminalLines: TerminalLine[];
  problems: { level: 'error' | 'warning'; text: string }[];
}
interface SheetListItem {
  date: string;
  voucherNo: string | null;
  closed: boolean;
  totalSales: string;
  cashSales: string;
  totalExpense: string;
  netAvailable: string;
}

const MIN_ROWS = 5;
const sum = (rows: { amount: string }[]): number => rows.reduce((a, r) => a + toCents(r.amount), 0);

/** The sheet's arithmetic, the same rules the server applies when it saves (the server stays the authority). */
export const calcSheet = (
  v: Pick<SheetView, 'openingPettyCash' | 'openingCash' | 'cashSales' | 'creditCardSales'>,
  f: {
    receive: string;
    expense: { amount: string }[];
    receipt: { amount: string }[];
    transfer: { amount: string }[];
    terminal: { settlement: string }[];
  },
) => {
  const totalExpense = sum(f.expense);
  const closingPetty = toCents(v.openingPettyCash) + toCents(f.receive) - totalExpense;
  const adjustment = sum(f.receipt);
  const totalAvailable = toCents(v.openingCash) + toCents(v.cashSales) + adjustment;
  const deposited = sum(f.transfer);
  const net = totalAvailable - deposited;
  const problems: { level: 'error' | 'warning'; text: string }[] = [];
  if (closingPetty < 0)
    problems.push({
      level: 'error',
      text: `Expenses (${fmt(fromCents(totalExpense))}) are more than the petty cash available (${fmt(fromCents(toCents(v.openingPettyCash) + toCents(f.receive)))}).`,
    });
  if (net < 0)
    problems.push({
      level: 'error',
      text: `Cash deposited / transferred (${fmt(fromCents(deposited))}) is more than the cash available (${fmt(fromCents(totalAvailable))}).`,
    });
  const settled = f.terminal.reduce((a, t) => a + toCents(t.settlement), 0);
  if (f.terminal.length > 0 && settled !== toCents(v.creditCardSales)) {
    problems.push({
      level: 'warning',
      text: `Terminal settlements (${fmt(fromCents(settled))}) do not match the credit card sales (${fmt(v.creditCardSales)}).`,
    });
  }
  return { totalExpense, closingPetty, adjustment, totalAvailable, deposited, net, problems };
};

type Col<T> = {
  key: keyof T & string;
  label: string;
  kind: 'text' | 'amount' | 'select';
  options?: string[];
  list?: string[];
  width?: string;
};

/** Editable grid with a blank "new row" at the end (the * row), a delete cross on every row and empty rows to fill the frame. */
function LineGrid<T extends object>({
  title,
  columns,
  rows,
  blank,
  onChange,
  disabled,
  testId,
}: {
  title: string;
  columns: Col<T>[];
  rows: T[];
  blank: T;
  onChange: (rows: T[]) => void;
  disabled: boolean;
  testId: string;
}) {
  const setCell = (i: number, key: keyof T & string, value: string) => {
    const next = [...rows];
    next[i] = { ...(next[i] ?? blank), [key]: value } as T;
    onChange(next);
  };
  const val = (r: T, k: string): string => (r as Record<string, string>)[k] ?? '';
  const fillers = Math.max(0, MIN_ROWS - rows.length - 1);
  return (
    <div data-testid={testId}>
      <h3 className="mb-1.5 text-sm font-bold text-blue-900 dark:text-sky-300">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full table-fixed text-[13px]">
          <thead className="bg-slate-100 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <tr>
              <th
                className="w-9 border-r border-slate-200 px-1 py-1.5 dark:border-slate-700"
                aria-label="Delete"
              />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`border-r border-slate-200 px-2 py-1.5 text-left font-semibold last:border-r-0 dark:border-slate-700 ${c.width ?? ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows, blank].map((row, i) => {
              const isNew = i === rows.length;
              return (
                <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="text-center">
                    {isNew ? (
                      <span className="text-slate-400">*</span>
                    ) : (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Delete ${title} line ${i + 1}`}
                        onClick={() => onChange(rows.filter((_, k) => k !== i))}
                        className="focus-ring rounded p-0.5 text-red-500 hover:bg-red-50 disabled:opacity-30"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </td>
                  {columns.map((c) => {
                    const common = {
                      'aria-label': `${title} ${c.label}${isNew ? ' (new line)' : ` ${i + 1}`}`,
                      disabled,
                      value: val(row, c.key),
                      className: `h-7 rounded-none border-0 border-r border-slate-100 px-2 shadow-none dark:border-slate-800 ${c.kind === 'amount' ? 'text-right tabular-nums' : ''}`,
                    };
                    return (
                      <td key={c.key} className="p-0">
                        {c.kind === 'select' ? (
                          <DeskSelect
                            {...common}
                            onChange={(e) => setCell(i, c.key, e.target.value)}
                          >
                            <option value="" />
                            {[
                              ...new Set([...(c.options ?? []), val(row, c.key)].filter(Boolean)),
                            ].map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </DeskSelect>
                        ) : (
                          <>
                            <DeskInput
                              {...common}
                              list={c.list ? `${testId}-${c.key}` : undefined}
                              inputMode={c.kind === 'amount' ? 'decimal' : undefined}
                              onChange={(e) =>
                                setCell(
                                  i,
                                  c.key,
                                  c.kind === 'amount'
                                    ? cleanAmount(e.target.value)
                                    : e.target.value,
                                )
                              }
                            />
                            {c.list ? (
                              <datalist id={`${testId}-${c.key}`}>
                                {c.list.map((o) => (
                                  <option key={o} value={o} />
                                ))}
                              </datalist>
                            ) : null}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {Array.from({ length: fillers }, (_, i) => (
              <tr
                key={`f${i}`}
                className="border-t border-slate-100 dark:border-slate-800"
                aria-hidden
              >
                <td className="h-7" colSpan={columns.length + 1} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SheetDoc = ({
  title,
  view,
  shop,
  calc,
  form,
  currency,
  voucher,
}: {
  title: string;
  view: SheetView;
  shop: string;
  calc: ReturnType<typeof calcSheet>;
  form: {
    expense: ExpenseLine[];
    receipt: ReceiptLine[];
    transfer: TransferLine[];
    terminal: TerminalLine[];
    receive: string;
  };
  currency: string;
  voucher: boolean;
}) => {
  const line = (label: string, value: string, bold = false) => (
    <tr className={bold ? 'font-bold' : ''}>
      <td className="py-0.5 pr-6">{label}</td>
      <td className="py-0.5 text-right tabular-nums">{value}</td>
    </tr>
  );
  return (
    <div data-testid="cash-doc">
      <div className="mb-3 border-b border-slate-400 pb-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <p>
          {shop} · {ymdDisplay(view.date)}{' '}
          {voucher && view.voucherNo ? `· Voucher ${view.voucherNo}` : ''} · {currency}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <table className="w-full">
          <tbody>
            {line('Opening Petty Cash', fmt(view.openingPettyCash))}
            {line('Receive Petty Cash', fmt(form.receive))}
            {line('Less: Total Expense', fmt(fromCents(calc.totalExpense)))}
            {line('Closing Petty Cash', fmt(fromCents(calc.closingPetty)), true)}
            {line('Credit Card Sales', fmt(view.creditCardSales))}
            {line('On Account Sales', fmt(view.onAccountSales))}
            {line('Cash Sales', fmt(view.cashSales))}
            {line('Redemption Amount', fmt(view.redemptionAmount))}
            {line('Total Sales', fmt(view.totalSales), true)}
            {line('Opening Cash', fmt(view.openingCash))}
            {line('Cash Sales', fmt(view.cashSales))}
            {line('Adjustment (other receipts)', fmt(fromCents(calc.adjustment)))}
            {line('Total Available Cash', fmt(fromCents(calc.totalAvailable)), true)}
            {line('Less: Deposited Cash in Bank', fmt(fromCents(calc.deposited)))}
            {line('Net Available Cash', fmt(fromCents(calc.net)), true)}
          </tbody>
        </table>
        <div className="space-y-3">
          {form.expense.length > 0 ? (
            <div>
              <h4 className="font-bold">Expenses</h4>
              <table className="w-full">
                <tbody>
                  {form.expense.map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.head}
                        {e.description ? ` — ${e.description}` : ''}
                      </td>
                      <td className="text-right tabular-nums">{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {form.receipt.length > 0 ? (
            <div>
              <h4 className="font-bold">Other receipts</h4>
              <table className="w-full">
                <tbody>
                  {form.receipt.map((e, i) => (
                    <tr key={i}>
                      <td>{e.head}</td>
                      <td className="text-right tabular-nums">{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {form.transfer.length > 0 ? (
            <div>
              <h4 className="font-bold">Fund transfers</h4>
              <table className="w-full">
                <tbody>
                  {form.transfer.map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.type}
                        {e.remarks ? ` — ${e.remarks}` : ''}
                      </td>
                      <td className="text-right tabular-nums">{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {form.terminal.length > 0 ? (
            <div>
              <h4 className="font-bold">Terminals</h4>
              <table className="w-full">
                <tbody>
                  {form.terminal.map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.terminal} {e.batch ? `(batch ${e.batch})` : ''}
                      </td>
                      <td className="text-right tabular-nums">
                        {fmt(e.gtech)} / {fmt(e.settlement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
      {voucher ? (
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
          {['Prepared by', 'Checked by', 'Approved by'].map((s) => (
            <div key={s} className="border-t border-slate-500 pt-1">
              {s}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const CashActivityScreen = ({
  onClose,
  canSave,
  canClear,
}: {
  onClose: () => void;
  canSave: boolean;
  canClear: boolean;
}) => {
  const { data, error } = useLookups();
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState('');
  const [view, setView] = useState<SheetView | null>(null);
  const [receive, setReceive] = useState('');
  const [expense, setExpense] = useState<ExpenseLine[]>([]);
  const [receipt, setReceipt] = useState<ReceiptLine[]>([]);
  const [transfer, setTransfer] = useState<TransferLine[]>([]);
  const [terminal, setTerminal] = useState<TerminalLine[]>([]);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [files, setFiles] = useState<SheetListItem[] | null>(null);
  const [fileFrom, setFileFrom] = useState('');
  const [fileTo, setFileTo] = useState('');
  const [repostFrom, setRepostFrom] = useState('');
  const [repostTo, setRepostTo] = useState('');
  const [doc, setDoc] = useState<'sheet' | 'voucher' | null>(null);
  const [pickShop, setPickShop] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !storeId) setStoreId(data.shops[0]?.id ?? '');
  }, [data, storeId]);
  const day = date || data?.today || '';

  const apply = useCallback((v: SheetView) => {
    setView(v);
    setReceive(v.receivePettyCash);
    setExpense(v.expenseLines);
    setReceipt(v.receiptLines);
    setTransfer(v.transferLines);
    setTerminal(v.terminalLines);
    setEditing(false);
  }, []);

  const load = useCallback(
    async (note?: string) => {
      if (!storeId || !day) return;
      try {
        const v = await apiRequest<SheetView>(
          `/sale-desk/cash-activity?storeId=${storeId}&date=${day}`,
        );
        apply(v);
        setMsg(note ? { kind: 'info', text: note } : null);
      } catch (e) {
        setView(null);
        setMsg({ kind: 'error', text: errText(e) });
      }
    },
    [storeId, day, apply],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const editable = !!view && !view.closed && canSave && (editing || !view.saved);
  const calc = useMemo(
    () => (view ? calcSheet(view, { receive, expense, receipt, transfer, terminal }) : null),
    [view, receive, expense, receipt, transfer, terminal],
  );
  const problems = calc?.problems ?? [];
  const shopName = data?.shops.find((s) => s.id === storeId)?.name ?? '';

  const clean = () => ({
    receivePettyCash: toNumberString(receive),
    expenseLines: expense
      .filter((l) => l.head || l.amount)
      .map((l) => ({ ...l, amount: toNumberString(l.amount) })),
    receiptLines: receipt
      .filter((l) => l.head || l.amount)
      .map((l) => ({ ...l, amount: toNumberString(l.amount) })),
    transferLines: transfer
      .filter((l) => l.type || l.amount)
      .map((l) => ({ ...l, amount: toNumberString(l.amount) })),
    terminalLines: terminal
      .filter((l) => l.terminal || l.settlement || l.gtech)
      .map((l) => ({
        ...l,
        gtech: toNumberString(l.gtech),
        settlement: toNumberString(l.settlement),
      })),
  });

  const save = async (close: boolean) => {
    setConfirmSave(false);
    setBusy(true);
    try {
      const v = await apiRequest<SheetView>('/sale-desk/cash-activity', {
        method: 'PUT',
        body: { storeId, date: day, ...clean(), close },
      });
      apply(v);
      setMsg({
        kind: 'ok',
        text: close ? `Day closed. Voucher ${v.voucherNo ?? ''}.` : 'Cash sheet saved.',
      });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const clearClosing = async () => {
    if (
      !window.confirm(
        `Clear the closing of ${ymdDisplay(day)}? The day will become editable again.`,
      )
    )
      return;
    try {
      apply(
        await apiRequest<SheetView>('/sale-desk/cash-activity/clear-closing', {
          method: 'POST',
          body: { storeId, date: day },
        }),
      );
      setMsg({ kind: 'ok', text: 'Closing cleared.' });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };

  const repost = async () => {
    const from = repostFrom || day;
    const to = repostTo || day;
    setBusy(true);
    try {
      const r = await apiRequest<{ updated: number; skippedClosed: number }>(
        '/sale-desk/cash-activity/repost',
        {
          method: 'POST',
          body: { storeId, from, to },
        },
      );
      await load();
      setMsg({
        kind: 'ok',
        text: `Reposted ${r.updated} sheet${r.updated === 1 ? '' : 's'} from the bills.${r.skippedClosed ? ` ${r.skippedClosed} closed sheet${r.skippedClosed === 1 ? ' was' : 's were'} left as they are.` : ''}`,
      });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const openFiles = async (from = fileFrom || day, to = fileTo || day) => {
    try {
      const r = await apiRequest<{ items: SheetListItem[] }>(
        `/sale-desk/cash-activity/list?storeId=${storeId}&from=${from}&to=${to}`,
      );
      setFiles(r.items);
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };

  if (!data) {
    return (
      <DeskWindow title="Daily Cash Activity" icon={Banknote} onClose={onClose}>
        {error ? (
          <InlineMessage kind="error">{error}</InlineMessage>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </DeskWindow>
    );
  }
  const L = (n: string | undefined) => fmt(n ?? '0');
  const amountInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <Row label={label} htmlFor={id} tone="green" labelWidth="w-44">
      <DeskInput
        id={id}
        inputMode="decimal"
        className="text-right tabular-nums"
        value={value}
        disabled={!editable}
        onChange={(e) => set(cleanAmount(e.target.value))}
        onBlur={() => set(value === '' ? '' : fromCents(toCents(value)))}
      />
    </Row>
  );
  const formState = { expense, receipt, transfer, terminal, receive };

  return (
    <>
      <DeskWindow
        title="Daily Cash Activity"
        icon={Banknote}
        onClose={onClose}
        width="max-w-6xl"
        testId="cash-activity"
        footer={
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Row label="Voucher No" htmlFor="ca-voucher" tone="blue" labelWidth="w-24">
                <DeskInput
                  id="ca-voucher"
                  readOnly
                  className="w-48"
                  value={view?.voucherNo ?? ''}
                />
              </Row>
              <label className="flex items-center gap-1.5 text-[13px] text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={!!view?.closed}
                  readOnly
                  disabled
                  aria-label="Closed"
                />{' '}
                Closed
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-0.5">
              <ToolButton
                icon={FolderOpen}
                label="View File"
                tone="primary"
                onClick={() => void openFiles()}
              />
              <ToolButton
                icon={RefreshCw}
                label="Reposting"
                tone="primary"
                disabled={!canSave || busy}
                onClick={() => void repost()}
              />
              <ToolButton
                icon={Receipt}
                label="Voucher"
                disabled={!view?.closed}
                onClick={() => setDoc('voucher')}
              />
              <ToolButton
                icon={Unlock}
                label="Clear Closing"
                tone="danger"
                disabled={!view?.closed || !canClear}
                onClick={() => void clearClosing()}
              />
              <ToolButton
                icon={Printer}
                label="Print"
                disabled={!view}
                onClick={() => setDoc('sheet')}
              />
              <ToolButton
                icon={Pencil}
                label="Edit"
                tone="success"
                disabled={!view || view.closed || !view.saved || editing || !canSave}
                onClick={() => setEditing(true)}
              />
              <ToolButton
                icon={Save}
                label="Save"
                tone="success"
                disabled={!editable || busy}
                onClick={() =>
                  problems.some((p) => p.level === 'error')
                    ? setShowProblems(true)
                    : setConfirmSave(true)
                }
              />
              <ToolButton
                icon={Undo2}
                label="Undo"
                tone="primary"
                disabled={!view || (!editing && view.saved)}
                onClick={() => void load('Changes undone.')}
              />
              <ToolButton icon={LogOut} label="Close" tone="success" onClick={onClose} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <Row label="Repost Date From" htmlFor="ca-rfrom" tone="blue" labelWidth="w-32">
                <DeskInput
                  id="ca-rfrom"
                  type="date"
                  className="w-36"
                  value={repostFrom || day}
                  max={data.today}
                  onChange={(e) => setRepostFrom(e.target.value)}
                />
              </Row>
              <Row label="Repost Date To" htmlFor="ca-rto" tone="blue" labelWidth="w-28">
                <DeskInput
                  id="ca-rto"
                  type="date"
                  className="w-36"
                  value={repostTo || day}
                  max={data.today}
                  onChange={(e) => setRepostTo(e.target.value)}
                />
              </Row>
            </div>
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <Row label="Shop Name" htmlFor="ca-shop" tone="blue" labelWidth="w-24">
              <DeskSelect id="ca-shop" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {data.shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </DeskSelect>
              <LookupButton label="Find shop" onClick={() => setPickShop(true)} />
            </Row>
            <Row
              label="Sale Date"
              htmlFor="ca-date"
              tone="blue"
              labelWidth="w-24"
              contentClass="flex-wrap"
            >
              <DeskInput
                id="ca-date"
                type="date"
                className="!w-40 shrink-0"
                value={day}
                max={data.today}
                onChange={(e) => setDate(e.target.value)}
              />
              <SmallButton onClick={() => void load('Sales figures refreshed from the bills.')}>
                Refresh
              </SmallButton>
              <SmallButton onClick={() => setShowProblems(true)}>Error</SmallButton>
              <SmallButton
                onClick={() => {
                  setShowProblems(false);
                  setMsg(null);
                }}
              >
                Clear Error
              </SmallButton>
            </Row>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
              <Row label="Opening Petty Cash" tone="brown" labelWidth="w-44">
                <NumBox label="Opening Petty Cash" value={L(view?.openingPettyCash)} />
              </Row>
              <Row label="LESS :  Total Expense" tone="brown" labelWidth="w-44">
                <NumBox label="Total Expense" value={fmt(fromCents(calc?.totalExpense ?? 0))} />
              </Row>
              <Row label="Closing Petty Cash" tone="brown" labelWidth="w-44">
                <NumBox
                  label="Closing Petty Cash"
                  strong
                  value={fmt(fromCents(calc?.closingPetty ?? 0))}
                  testId="closing-petty"
                />
              </Row>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
              {amountInput('ca-receive', 'ADD :  Receive Petty Cash', receive, setReceive)}
              <Row label="Credit Card Sales" tone="green" labelWidth="w-44">
                <NumBox
                  label="Credit Card Sales"
                  value={L(view?.creditCardSales)}
                  testId="card-sales"
                />
              </Row>
              <Row label="On Account Sales" tone="green" labelWidth="w-44">
                <NumBox label="On Account Sales" value={L(view?.onAccountSales)} />
              </Row>
              <Row label="Cash Sales" tone="green" labelWidth="w-44">
                <NumBox label="Cash Sales" value={L(view?.cashSales)} testId="cash-sales" />
              </Row>
              <Row label="Redemption Amount" tone="green" labelWidth="w-44">
                <NumBox label="Redemption Amount" value={L(view?.redemptionAmount)} />
              </Row>
              <Row label="Total Sales" tone="green" labelWidth="w-44">
                <NumBox
                  label="Total Sales"
                  strong
                  value={L(view?.totalSales)}
                  testId="total-sales"
                />
              </Row>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
              <Row label="ADD :  Opening Cash" tone="blue" labelWidth="w-44">
                <NumBox label="Opening Cash" value={L(view?.openingCash)} />
              </Row>
              <Row label="Cash Sales" tone="blue" labelWidth="w-44">
                <NumBox label="Cash Sales (drawer)" value={L(view?.cashSales)} />
              </Row>
              <Row label="Adjustment" tone="blue" labelWidth="w-44">
                <NumBox label="Adjustment" value={fmt(fromCents(calc?.adjustment ?? 0))} />
              </Row>
              <Row label="Total Avalable Cash" tone="green" labelWidth="w-44">
                <NumBox
                  label="Total Available Cash"
                  strong
                  value={fmt(fromCents(calc?.totalAvailable ?? 0))}
                  testId="total-available"
                />
              </Row>
            </div>
          </div>

          <div className="space-y-4">
            <LineGrid<ExpenseLine>
              title="Expense Detail"
              testId="grid-expense"
              disabled={!editable}
              blank={{ head: '', description: '', amount: '' }}
              rows={expense}
              onChange={setExpense}
              columns={[
                {
                  key: 'head',
                  label: 'Expense Detail',
                  kind: 'text',
                  list: data.expenseHeads,
                  width: 'w-[40%]',
                },
                { key: 'description', label: 'Description', kind: 'text' },
                { key: 'amount', label: 'Amount', kind: 'amount', width: 'w-28' },
              ]}
            />
            <LineGrid<ReceiptLine>
              title="Other Receipt"
              testId="grid-receipt"
              disabled={!editable}
              blank={{ head: '', amount: '' }}
              rows={receipt}
              onChange={setReceipt}
              columns={[
                { key: 'head', label: 'Other Receipt', kind: 'text', list: data.receiptHeads },
                { key: 'amount', label: 'Amount', kind: 'amount', width: 'w-32' },
              ]}
            />
            <LineGrid<TerminalLine>
              title="Terminal Detail"
              testId="grid-terminal"
              disabled={!editable}
              blank={{ terminal: '', gtech: '', settlement: '', batch: '' }}
              rows={terminal}
              onChange={setTerminal}
              columns={[
                { key: 'terminal', label: 'Terminal', kind: 'text', list: data.terminals },
                { key: 'gtech', label: 'GTech', kind: 'amount' },
                { key: 'settlement', label: 'Settlement', kind: 'amount' },
                { key: 'batch', label: 'Batch #', kind: 'text' },
              ]}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <LineGrid<TransferLine>
              title="Fund Transfer Detail"
              testId="grid-transfer"
              disabled={!editable}
              blank={{ type: '', remarks: '', amount: '' }}
              rows={transfer}
              onChange={setTransfer}
              columns={[
                {
                  key: 'type',
                  label: 'Transfer Type',
                  kind: 'select',
                  options: data.transferTypes,
                },
                { key: 'remarks', label: 'Remarks', kind: 'text' },
                { key: 'amount', label: 'Amount', kind: 'amount', width: 'w-24' },
              ]}
            />
            <Row label="LESS :  Deposited Cash in Bank" tone="red" labelWidth="w-44">
              <NumBox label="Deposited Cash in Bank" value={fmt(fromCents(calc?.deposited ?? 0))} />
            </Row>
            <Row label="Net Available Cash" tone="blue" labelWidth="w-44">
              <NumBox
                label="Net Available Cash"
                strong
                value={fmt(fromCents(calc?.net ?? 0))}
                testId="net-available"
              />
            </Row>
          </div>
          <div className="space-y-2 self-end">
            {msg ? <InlineMessage kind={msg.kind}>{msg.text}</InlineMessage> : null}
            {view?.closed ? (
              <InlineMessage kind="info">
                This day is closed. Use Clear Closing to change it.
              </InlineMessage>
            ) : null}
            {!canSave ? (
              <InlineMessage kind="info">You can view this sheet but not change it.</InlineMessage>
            ) : null}
            {problems.length > 0 ? (
              <InlineMessage kind={problems.some((p) => p.level === 'error') ? 'error' : 'warn'}>
                {problems.length} problem{problems.length === 1 ? '' : 's'} on this sheet — press
                Error to see them.
              </InlineMessage>
            ) : null}
          </div>
        </div>
      </DeskWindow>

      {showProblems ? (
        <DeskModal
          title="Sheet check"
          onClose={() => setShowProblems(false)}
          width="max-w-lg"
          testId="problems"
        >
          <div className="space-y-2 p-4">
            {problems.length === 0 ? (
              <InlineMessage kind="ok">No problems found on this sheet.</InlineMessage>
            ) : null}
            {problems.map((p, i) => (
              <InlineMessage key={i} kind={p.level === 'error' ? 'error' : 'warn'}>
                {p.text}
              </InlineMessage>
            ))}
            <div className="flex justify-end">
              <SmallButton onClick={() => setShowProblems(false)}>OK</SmallButton>
            </div>
          </div>
        </DeskModal>
      ) : null}

      {confirmSave ? (
        <DeskModal
          title="Save cash sheet"
          onClose={() => setConfirmSave(false)}
          width="max-w-md"
          testId="confirm-save"
        >
          <div className="space-y-4 p-4">
            <p className="text-sm">
              Save the sheet of <strong>{ymdDisplay(day)}</strong>? Closing the day locks it, issues
              the voucher number and stops changes to that day&apos;s bills until the closing is
              cleared.
            </p>
            {problems.some((p) => p.level === 'warning') ? (
              <InlineMessage kind="warn">
                {problems
                  .filter((p) => p.level === 'warning')
                  .map((p) => p.text)
                  .join(' ')}
              </InlineMessage>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <SmallButton onClick={() => setConfirmSave(false)}>Cancel</SmallButton>
              <SmallButton onClick={() => void save(false)}>Save</SmallButton>
              <SmallButton tone="primary" onClick={() => void save(true)}>
                Save and close the day
              </SmallButton>
            </div>
          </div>
        </DeskModal>
      ) : null}

      {files ? (
        <DeskModal
          title="Saved cash sheets"
          onClose={() => setFiles(null)}
          width="max-w-2xl"
          testId="file-list"
        >
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <DeskInput
                type="date"
                aria-label="List from"
                className="!w-44 shrink-0"
                value={fileFrom || day}
                onChange={(e) => setFileFrom(e.target.value)}
              />
              <DeskInput
                type="date"
                aria-label="List to"
                className="!w-44 shrink-0"
                value={fileTo || day}
                onChange={(e) => setFileTo(e.target.value)}
              />
              <SmallButton
                tone="primary"
                onClick={() => void openFiles(fileFrom || day, fileTo || day)}
              >
                Show
              </SmallButton>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-1.5">Date</th>
                    <th className="px-3 py-1.5">Voucher</th>
                    <th className="px-3 py-1.5 text-right">Total sales</th>
                    <th className="px-3 py-1.5 text-right">Net cash</th>
                    <th className="px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr
                      key={f.date}
                      tabIndex={0}
                      className="cursor-pointer border-t border-slate-100 hover:bg-sky-50 dark:border-slate-800 dark:hover:bg-slate-800"
                      onClick={() => {
                        setDate(f.date);
                        setFiles(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setDate(f.date);
                          setFiles(null);
                        }
                      }}
                    >
                      <td className="px-3 py-1.5">{ymdDisplay(f.date)}</td>
                      <td className="px-3 py-1.5">{f.voucherNo ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(f.totalSales)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(f.netAvailable)}</td>
                      <td className="px-3 py-1.5">{f.closed ? 'Closed' : 'Open'}</td>
                    </tr>
                  ))}
                  {files.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                        No saved sheets in this period.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </DeskModal>
      ) : null}

      {doc && view && calc ? (
        <DocPreview
          title={doc === 'voucher' ? 'Cash Voucher' : 'Daily Cash Activity'}
          paper="a4"
          onClose={() => setDoc(null)}
        >
          <SheetDoc
            title={doc === 'voucher' ? 'Cash Voucher' : 'Daily Cash Activity'}
            view={view}
            shop={shopName}
            calc={calc}
            form={formState}
            currency={(data as Lookups).currency}
            voucher={doc === 'voucher'}
          />
        </DocPreview>
      ) : null}
      {pickShop ? (
        <ShopPicker
          shops={data.shops}
          onClose={() => setPickShop(false)}
          onPick={(s) => {
            setStoreId(s.id);
            setPickShop(false);
          }}
        />
      ) : null}
    </>
  );
};
