import { useEffect, useMemo, useState } from 'react';
import { CreditCard, LogOut, Undo2 } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import {
  DeskInput,
  DeskModal,
  DeskSelect,
  DeskWindow,
  InlineMessage,
  Lcd,
  Row,
  SmallButton,
  ToolButton,
  NumBox,
} from './DeskWindow.js';
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

interface BillRow {
  id: string;
  invoiceNo: string;
  soldAt: string;
  customerName: string | null;
  grandTotal: string;
  status: string;
}
interface Tender {
  id: string;
  invoiceNo: string;
  storeName: string;
  netReceivable: string;
  cash: string;
  card: string;
  onAccount: string;
  redemption: string;
  customerId: string | null;
  customerName: string | null;
  terminal: string;
  fbrInvoiceNo: string;
  lockedReason: string | null;
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const CashCardUpdateScreen = ({ onClose }: { onClose: () => void }) => {
  const { data, error } = useLookups();
  const [date, setDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [tender, setTender] = useState<Tender | null>(null);
  const [cash, setCash] = useState('');
  const [card, setCard] = useState('');
  const [onAccount, setOnAccount] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [terminal, setTerminal] = useState('');
  const [fbr, setFbr] = useState('');
  const [list, setList] = useState<BillRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !storeId) setStoreId(data.shops[0]?.id ?? '');
  }, [data, storeId]);

  const day = date || data?.today || '';

  const fill = (t: Tender) => {
    setTender(t);
    setBillNo(t.invoiceNo);
    setCash(t.cash);
    setCard(t.card);
    setOnAccount(t.onAccount);
    setCustomerId(t.customerId ?? '');
    setTerminal(t.terminal);
    setFbr(t.fbrInvoiceNo);
  };
  const reset = () => {
    setTender(null);
    setBillNo('');
    setCash('');
    setCard('');
    setOnAccount('');
    setCustomerId('');
    setTerminal('');
    setFbr('');
    setMsg(null);
  };

  const loadBills = async (q?: string): Promise<BillRow[]> => {
    const p = new URLSearchParams({ storeId, date: day });
    if (q) p.set('search', q);
    return (await apiRequest<{ items: BillRow[] }>(`/sale-desk/bills?${p}`)).items;
  };
  const open = async (id: string) => {
    try {
      fill(await apiRequest<Tender>(`/sale-desk/bills/${id}/tender`));
      setMsg(null);
      setList(null);
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };
  const openList = async () => {
    if (!storeId) return setMsg({ kind: 'error', text: 'Choose a shop first.' });
    try {
      setSearch('');
      setList(await loadBills());
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };
  const lookupTyped = async () => {
    const q = billNo.trim();
    if (!q || !storeId) return;
    try {
      const rows = await loadBills(q);
      const exact =
        rows.find((r) => r.invoiceNo.toLowerCase() === q.toLowerCase()) ??
        (rows.length === 1 ? rows[0] : undefined);
      if (exact) await open(exact.id);
      else
        setMsg({
          kind: 'error',
          text: `No bill "${q}" was found on ${ymdDisplay(day)} in this shop.`,
        });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };

  const entered = toCents(cash) + toCents(card) + toCents(onAccount);
  const net = tender ? toCents(tender.netReceivable) : 0;
  const diff = net - entered;
  const locked = !tender || !!tender.lockedReason;

  const update = async () => {
    if (!tender) return;
    setBusy(true);
    try {
      const saved = await apiRequest<Tender>(`/sale-desk/bills/${tender.id}/tender`, {
        method: 'PUT',
        body: {
          cash: toNumberString(cash),
          card: toNumberString(card),
          onAccount: toNumberString(onAccount),
          ...(customerId ? { customerId } : {}),
          terminal,
          fbrInvoiceNo: fbr,
        },
      });
      fill(saved);
      setMsg({ kind: 'ok', text: `Bill ${saved.invoiceNo} updated.` });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => list ?? [], [list]);

  if (!data) {
    return (
      <DeskWindow title="Cash and Credit Card Update" icon={CreditCard} onClose={onClose}>
        {error ? (
          <InlineMessage kind="error">{error}</InlineMessage>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </DeskWindow>
    );
  }
  const amountField = (id: string, label: string, value: string, set: (v: string) => void) => (
    <Row label={label} htmlFor={id} tone="blue" labelWidth="w-44">
      <DeskInput
        id={id}
        inputMode="decimal"
        className="text-right tabular-nums"
        value={value}
        disabled={locked}
        onChange={(e) => set(cleanAmount(e.target.value))}
        onBlur={() => set(value === '' ? (tender ? '0.00' : '') : fromCents(toCents(value)))}
      />
    </Row>
  );

  return (
    <>
      <DeskWindow
        title="Cash and Credit Card Update"
        icon={CreditCard}
        onClose={onClose}
        width="max-w-xl"
        testId="card-update"
        footer={
          <div className="flex justify-end gap-1">
            <ToolButton
              icon={Undo2}
              label="Undo"
              disabled={!tender}
              onClick={() => (tender ? void open(tender.id) : undefined)}
            />
            <ToolButton icon={LogOut} label="Exit" tone="primary" onClick={onClose} />
          </div>
        }
      >
        <div className="space-y-3">
          <h3 className="rounded-md bg-gradient-to-r from-white to-slate-100 px-3 py-3 text-xl font-bold text-slate-900 dark:from-slate-800 dark:to-slate-900 dark:text-white">
            Cash and Credit Card Update
          </h3>
          <Row label="Date From :" htmlFor="cu-date" tone="blue" labelWidth="w-44">
            <DeskInput
              id="cu-date"
              type="date"
              value={day}
              max={data.today}
              onChange={(e) => {
                setDate(e.target.value);
                reset();
              }}
            />
          </Row>
          <Row label="Shop" htmlFor="cu-shop" tone="blue" labelWidth="w-44">
            <DeskSelect
              id="cu-shop"
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                reset();
              }}
            >
              {data.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </DeskSelect>
          </Row>
          <Row label="Bill # :" htmlFor="cu-bill" tone="blue" labelWidth="w-44">
            <DeskInput
              id="cu-bill"
              value={billNo}
              placeholder="Type a bill no. and press Enter"
              onChange={(e) => setBillNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupTyped();
              }}
            />
            <SmallButton onClick={() => void openList()}>List</SmallButton>
            <SmallButton
              tone="primary"
              disabled={locked || busy || diff !== 0}
              onClick={() => void update()}
            >
              Update
            </SmallButton>
          </Row>

          <Row label="Net Receivable Amount" tone="red" labelWidth="w-44">
            <Lcd
              label="Net Receivable Amount"
              value={tender ? fmt(tender.netReceivable) : '0'}
              testId="net-receivable"
            />
          </Row>
          {amountField('cu-cash', 'Cash Amount', cash, setCash)}
          {amountField('cu-card', 'DR / CR Card Amount', card, setCard)}
          {amountField('cu-acc', 'On Account Amount', onAccount, setOnAccount)}
          <Row label="Redemption Amount" tone="blue" labelWidth="w-44">
            <NumBox label="Redemption Amount" value={tender ? fmt(tender.redemption) : '0'} />
          </Row>
          <Row label="On Account" htmlFor="cu-cust" tone="blue" labelWidth="w-44">
            <DeskSelect
              id="cu-cust"
              value={customerId}
              disabled={locked}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">
                {tender?.customerName && !customerId ? tender.customerName : '— no customer —'}
              </option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` (${c.phone})` : ''}
                </option>
              ))}
            </DeskSelect>
          </Row>
          <Row label="Terminal" htmlFor="cu-term" tone="blue" labelWidth="w-44">
            <DeskInput
              id="cu-term"
              list="cu-terminals"
              value={terminal}
              disabled={locked}
              onChange={(e) => setTerminal(e.target.value)}
            />
            <datalist id="cu-terminals">
              {data.terminals.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <SmallButton disabled={locked} onClick={() => setTerminal('')}>
              Clear
            </SmallButton>
          </Row>
          <Row label="FBR Inv #" htmlFor="cu-fbr" tone="blue" labelWidth="w-44">
            <DeskInput
              id="cu-fbr"
              value={fbr}
              maxLength={60}
              disabled={locked}
              onChange={(e) => setFbr(e.target.value)}
            />
            <SmallButton disabled={locked} onClick={() => setFbr('')}>
              Clear
            </SmallButton>
          </Row>

          {tender && !tender.lockedReason && diff !== 0 ? (
            <InlineMessage kind="warn">
              Cash + card + on account is {fmt(fromCents(entered))}; it must equal the net
              receivable amount ({fmt(tender.netReceivable)}). Difference: {fmt(fromCents(diff))}.
            </InlineMessage>
          ) : null}
          {tender?.lockedReason ? (
            <InlineMessage kind="warn">{tender.lockedReason}</InlineMessage>
          ) : null}
          {msg ? <InlineMessage kind={msg.kind}>{msg.text}</InlineMessage> : null}
          {!tender && !msg ? (
            <InlineMessage kind="info">
              Choose the date and shop, then pick the bill with List.
            </InlineMessage>
          ) : null}
        </div>
      </DeskWindow>

      {list ? (
        <DeskModal
          title={`Bills of ${ymdDisplay(day)}`}
          onClose={() => setList(null)}
          width="max-w-lg"
          testId="bill-list"
        >
          <div className="space-y-3 p-4">
            <DeskInput
              autoFocus
              aria-label="Search bills"
              placeholder="Bill no. or customer"
              value={search}
              onChange={async (e) => {
                setSearch(e.target.value);
                try {
                  setList(await loadBills(e.target.value));
                } catch {
                  /* keep the previous list */
                }
              }}
            />
            <ul className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {shown.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">No bills.</li>
              ) : null}
              {shown.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => void open(b.id)}
                    className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-800"
                  >
                    <span>
                      <span className="font-semibold">{b.invoiceNo}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {timeOf(b.soldAt)} {b.customerName ? `· ${b.customerName}` : ''}
                      </span>
                    </span>
                    <span className="tabular-nums">{fmt(b.grandTotal)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </DeskModal>
      ) : null}
    </>
  );
};
