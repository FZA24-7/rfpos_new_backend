import { useEffect, useState } from 'react';
import { FileSpreadsheet, LogOut, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { apiDownload, apiRequest } from '../api/client.js';
import { DeskInput, DeskSelect, DeskWindow, InlineMessage, Row, ToolButton } from './DeskWindow.js';
import { errText, fmt, useLookups, ymdDisplay } from './deskApi.js';

interface FbrRow {
  id: string;
  invoiceNo: string;
  date: string;
  storeName: string;
  customerName: string | null;
  grandTotal: string;
  taxTotal: string;
  fbrInvoiceNo: string;
  status: 'PENDING' | 'POSTED';
}

export const FbrRepostScreen = ({
  onClose,
  canEdit,
}: {
  onClose: () => void;
  canEdit: boolean;
}) => {
  const { data, error } = useLookups();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState<'pending' | 'posted' | 'all'>('pending');
  const [rows, setRows] = useState<FbrRow[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const dFrom = from || data?.today || '';
  const dTo = to || data?.today || '';
  const params = (format?: 'csv') => {
    const p = new URLSearchParams({ from: dFrom, to: dTo, status });
    if (storeId) p.set('storeId', storeId);
    if (format) p.set('format', format);
    return p.toString();
  };

  const search = async () => {
    if (!data) return;
    if (dFrom > dTo)
      return setMsg({ kind: 'error', text: 'The "from" date must not be after the "to" date.' });
    setBusy(true);
    try {
      const r = await apiRequest<{ items: FbrRow[]; pending: number }>(
        `/sale-desk/fbr?${params()}`,
      );
      setRows(r.items);
      setPending(r.pending);
      setEdited({});
      setMsg(
        r.items.length === 0 ? { kind: 'info', text: 'No bills match this selection.' } : null,
      );
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (data) void search();
    // run once when the lookups arrive
  }, [data]);

  const changed = rows.filter(
    (r) => edited[r.id] !== undefined && edited[r.id]!.trim() !== r.fbrInvoiceNo,
  );

  const repost = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ updated: number }>('/sale-desk/fbr/repost', {
        method: 'POST',
        body: { items: changed.map((r) => ({ saleId: r.id, fbrInvoiceNo: edited[r.id]!.trim() })) },
      });
      await search();
      setMsg({ kind: 'ok', text: `${res.updated} bill${res.updated === 1 ? '' : 's'} updated.` });
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <DeskWindow title="FBR Repost Period" icon={ShieldCheck} onClose={onClose}>
        {error ? (
          <InlineMessage kind="error">{error}</InlineMessage>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </DeskWindow>
    );
  }

  return (
    <DeskWindow
      title="FBR Repost Period"
      icon={ShieldCheck}
      onClose={onClose}
      width="max-w-5xl"
      testId="fbr-repost"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-slate-600 dark:text-slate-300">
            <strong data-testid="fbr-pending">{pending}</strong> bill{pending === 1 ? '' : 's'}{' '}
            without an FBR invoice number in this period.
          </p>
          <div className="flex gap-1">
            <ToolButton
              icon={RefreshCw}
              label="Refresh"
              disabled={busy}
              onClick={() => void search()}
            />
            <ToolButton
              icon={FileSpreadsheet}
              label="Excel"
              tone="success"
              onClick={() =>
                void apiDownload(`/sale-desk/fbr?${params('csv')}`, 'fbr.csv').catch((e) =>
                  setMsg({ kind: 'error', text: errText(e) }),
                )
              }
            />
            <ToolButton
              icon={Save}
              label="Repost"
              tone="success"
              disabled={!canEdit || busy || changed.length === 0}
              onClick={() => void repost()}
            />
            <ToolButton icon={LogOut} label="Exit" tone="primary" onClick={onClose} />
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Row label="From" htmlFor="fbr-from" labelWidth="w-12">
            <DeskInput
              id="fbr-from"
              type="date"
              value={dFrom}
              max={data.today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Row>
          <Row label="To" htmlFor="fbr-to" labelWidth="w-12">
            <DeskInput
              id="fbr-to"
              type="date"
              value={dTo}
              max={data.today}
              onChange={(e) => setTo(e.target.value)}
            />
          </Row>
          <Row label="Shop" htmlFor="fbr-shop" labelWidth="w-12">
            <DeskSelect id="fbr-shop" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">All shops</option>
              {data.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </DeskSelect>
          </Row>
          <Row label="Status" htmlFor="fbr-status" labelWidth="w-14">
            <DeskSelect
              id="fbr-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="pending">Pending</option>
              <option value="posted">Posted</option>
              <option value="all">All</option>
            </DeskSelect>
            <button
              type="button"
              onClick={() => void search()}
              className="focus-ring h-8 shrink-0 rounded-md bg-brand-600 px-3 text-[13px] font-medium text-white hover:bg-brand-700"
            >
              Show
            </button>
          </Row>
        </div>
        {msg ? <InlineMessage kind={msg.kind}>{msg.text}</InlineMessage> : null}
        <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Bill No</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Shop</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Bill Total</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2">FBR Inv #</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = edited[r.id] ?? r.fbrInvoiceNo;
                return (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1.5 font-medium">{r.invoiceNo}</td>
                    <td className="px-3 py-1.5">{ymdDisplay(r.date)}</td>
                    <td className="px-3 py-1.5">{r.storeName}</td>
                    <td className="px-3 py-1.5">{r.customerName ?? ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.grandTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.taxTotal)}</td>
                    <td className="px-3 py-1.5">
                      <DeskInput
                        aria-label={`FBR invoice number of ${r.invoiceNo}`}
                        value={value}
                        maxLength={60}
                        disabled={!canEdit}
                        className="h-7"
                        onChange={(e) => setEdited((m) => ({ ...m, [r.id]: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.status === 'POSTED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                      >
                        {r.status === 'POSTED' ? 'Posted' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    Nothing to show.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Enter the invoice number FBR returned for each bill and press Repost. Clearing a number
          puts the bill back to Pending. Excel exports the list for upload to the FBR portal.
        </p>
      </div>
    </DeskWindow>
  );
};
