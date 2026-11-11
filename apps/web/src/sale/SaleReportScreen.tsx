import { useState } from 'react';
import { BarChart3, Check, FileSpreadsheet, LogOut, Printer, Receipt, MapPin } from 'lucide-react';
import { SALES_PERSON_REPORT_TYPES, DETAIL_REPORT_TYPES } from '@mafk/shared';
import { apiDownload, apiRequest } from '../api/client.js';
import {
  DeskInput,
  DeskModal,
  DeskSelect,
  DeskWindow,
  InlineMessage,
  LookupButton,
  Row,
  SmallButton,
  ToolButton,
} from './DeskWindow.js';
import { errText, useLookups } from './deskApi.js';
import type { Lookups } from './deskApi.js';
import { ReportViewer } from './ReportViewer.js';
import type { ReportResult } from './ReportViewer.js';
import type { PaperSize } from './DocPreview.js';
import { ShopPicker } from './ShopPicker.js';

export type ReportKind = 'daily' | 'bill' | 'person';

const CONFIG: Record<
  ReportKind,
  {
    window: string;
    path: string;
    salesman: boolean;
    region: boolean;
    slip: boolean;
    types: readonly { value: string; label: string }[];
    defaultType: string;
    icon: typeof BarChart3;
    narrow: string;
  }
> = {
  daily: {
    window: 'Daily Closing Report',
    path: '/sale-desk/reports/daily-closing',
    salesman: true,
    region: false,
    slip: true,
    types: DETAIL_REPORT_TYPES,
    defaultType: 'summary',
    icon: BarChart3,
    narrow: 'max-w-lg',
  },
  bill: {
    window: 'Bill Wise Report',
    path: '/sale-desk/reports/bill-wise',
    salesman: false,
    region: true,
    slip: false,
    types: DETAIL_REPORT_TYPES,
    defaultType: 'summary',
    icon: Receipt,
    narrow: 'max-w-lg',
  },
  person: {
    window: 'Sales Person Wise Sales Report',
    path: '/sale-desk/reports/sales-person',
    salesman: true,
    region: false,
    slip: true,
    types: SALES_PERSON_REPORT_TYPES,
    defaultType: 'day-wise',
    icon: BarChart3,
    narrow: 'max-w-xl',
  },
};

/** Moves a shop's region (used by the Bill Wise "Region" filter). Needs the settings.edit right. */
const RegionManager = ({
  data,
  onDone,
  onClose,
}: {
  data: Lookups;
  onDone: () => void;
  onClose: () => void;
}) => {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(data.shops.map((s) => [s.id, s.region ?? ''])),
  );
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const save = async () => {
    try {
      for (const s of data.shops) {
        if ((s.region ?? '') !== (values[s.id] ?? '').trim()) {
          await apiRequest(`/sale-desk/shops/${s.id}/region`, {
            method: 'PUT',
            body: { region: (values[s.id] ?? '').trim() },
          });
        }
      }
      setMsg({ kind: 'ok', text: 'Regions saved.' });
      onDone();
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };
  return (
    <DeskModal title="Shop regions" onClose={onClose} width="max-w-md" testId="region-manager">
      <div className="space-y-3 p-4">
        <p className="text-[13px] text-slate-600 dark:text-slate-300">
          Give each shop a region (for example North, South). The Bill Wise report can then be
          limited to one region.
        </p>
        {data.shops.map((s) => (
          <Row key={s.id} label={s.name} labelWidth="w-40">
            <DeskInput
              aria-label={`Region of ${s.name}`}
              value={values[s.id] ?? ''}
              maxLength={60}
              onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
            />
          </Row>
        ))}
        {msg ? <InlineMessage kind={msg.kind}>{msg.text}</InlineMessage> : null}
        <div className="flex justify-end gap-2">
          <SmallButton onClick={onClose}>Close</SmallButton>
          <SmallButton tone="primary" onClick={() => void save()}>
            Save regions
          </SmallButton>
        </div>
      </div>
    </DeskModal>
  );
};

export const SaleReportScreen = ({
  kind,
  onClose,
  canEditRegions = false,
}: {
  kind: ReportKind;
  onClose: () => void;
  canEditRegions?: boolean;
}) => {
  const cfg = CONFIG[kind];
  const { data, error, reload } = useLookups();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [storeId, setStoreId] = useState('');
  const [salesman, setSalesman] = useState('');
  const [region, setRegion] = useState('');
  const [type, setType] = useState(cfg.defaultType);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [report, setReport] = useState<{ result: ReportResult; paper: PaperSize } | null>(null);
  const [pickShop, setPickShop] = useState(false);
  const [regions, setRegions] = useState(false);

  if (!data) {
    return (
      <DeskWindow title={cfg.window} icon={cfg.icon} onClose={onClose} width={cfg.narrow}>
        {error ? (
          <InlineMessage kind="error">{error}</InlineMessage>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </DeskWindow>
    );
  }
  const dateFrom = from || data.today;
  const dateTo = to || data.today;

  const query = (format?: 'csv'): string => {
    const q = new URLSearchParams({ from: dateFrom, to: dateTo, type });
    if (storeId) q.set('storeId', storeId);
    if (cfg.salesman && salesman) q.set('salesman', salesman);
    if (cfg.region && region) q.set('region', region);
    if (format) q.set('format', format);
    return q.toString();
  };
  const rangeProblem =
    dateFrom > dateTo ? 'The "from" date must not be after the "upto" date.' : '';

  const run = async (paper: PaperSize) => {
    if (rangeProblem) return setProblem(rangeProblem);
    setBusy(true);
    setProblem('');
    try {
      setReport({ result: await apiRequest<ReportResult>(`${cfg.path}?${query()}`), paper });
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const excel = async () => {
    if (rangeProblem) return setProblem(rangeProblem);
    setProblem('');
    try {
      await apiDownload(`${cfg.path}?${query('csv')}`, `${cfg.window}.csv`);
    } catch (e) {
      setProblem(errText(e));
    }
  };

  return (
    <>
      <DeskWindow
        title={cfg.window}
        icon={cfg.icon}
        onClose={onClose}
        width={cfg.narrow}
        testId={`report-${kind}`}
        footer={
          <div className="flex justify-end gap-1">
            <ToolButton
              icon={FileSpreadsheet}
              label="Excel"
              tone="success"
              disabled={busy}
              onClick={() => void excel()}
            />
            {cfg.slip ? (
              <>
                <ToolButton
                  icon={Printer}
                  label="Print A4"
                  tone="success"
                  disabled={busy}
                  onClick={() => void run('a4')}
                />
                <ToolButton
                  icon={Printer}
                  label="Print Slip"
                  tone="success"
                  disabled={busy}
                  onClick={() => void run('slip')}
                />
              </>
            ) : (
              <ToolButton
                icon={Check}
                label="OK"
                tone="success"
                disabled={busy}
                onClick={() => void run('a4')}
              />
            )}
            <ToolButton icon={LogOut} label="Exit" tone="primary" onClick={onClose} />
          </div>
        }
      >
        <div className="space-y-4">
          <fieldset className="rounded-lg border border-slate-300 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <legend className="px-1.5 text-xs font-semibold text-blue-700 dark:text-sky-300">
              Bill Date
            </legend>
            <div className="space-y-2">
              <Row label="From :" htmlFor="rep-from">
                <DeskInput
                  id="rep-from"
                  type="date"
                  value={dateFrom}
                  max={data.today}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Row>
              <Row label="Upto :" htmlFor="rep-to">
                <DeskInput
                  id="rep-to"
                  type="date"
                  value={dateTo}
                  max={data.today}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Row>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-slate-300 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <legend className="px-1.5 text-xs font-semibold text-blue-700 dark:text-sky-300">
              Selections Criteria
            </legend>
            <div className="space-y-3">
              <div>
                <label htmlFor="rep-shop" className="mb-1 block text-[13px] font-bold">
                  Shop
                </label>
                <div className="flex gap-2">
                  <DeskSelect
                    id="rep-shop"
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    <option value="">All shops</option>
                    {data.shops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </DeskSelect>
                  {kind !== 'bill' ? (
                    <LookupButton label="Find shop" onClick={() => setPickShop(true)} />
                  ) : null}
                </div>
              </div>
              {cfg.region ? (
                <div>
                  <label htmlFor="rep-region" className="mb-1 block text-[13px] font-bold">
                    Region
                  </label>
                  <div className="flex gap-2">
                    <DeskSelect
                      id="rep-region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                    >
                      <option value="">All regions</option>
                      {data.regions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </DeskSelect>
                    {canEditRegions ? (
                      <LookupButton label="Manage regions" onClick={() => setRegions(true)} />
                    ) : null}
                  </div>
                  {data.regions.length === 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin size={12} /> No shop has a region yet
                      {canEditRegions ? ' — use the pin button to set them.' : '.'}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {cfg.salesman ? (
                <div>
                  <label htmlFor="rep-sales" className="mb-1 block text-[13px] font-bold">
                    Sales Person
                  </label>
                  <DeskSelect
                    id="rep-sales"
                    value={salesman}
                    onChange={(e) => setSalesman(e.target.value)}
                  >
                    <option value="">All sales persons</option>
                    {data.salesmen.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </DeskSelect>
                </div>
              ) : null}
              <div>
                <label htmlFor="rep-type" className="mb-1 block text-[13px] font-bold">
                  Report Type
                </label>
                <DeskSelect
                  id="rep-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="sm:w-64"
                >
                  {cfg.types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </DeskSelect>
              </div>
            </div>
          </fieldset>
          {problem ? <InlineMessage kind="error">{problem}</InlineMessage> : null}
        </div>
      </DeskWindow>
      {report ? (
        <ReportViewer
          report={report.result}
          paper={report.paper}
          onClose={() => setReport(null)}
          onExcel={() => void excel()}
        />
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
      {regions ? (
        <RegionManager data={data} onDone={() => void reload()} onClose={() => setRegions(false)} />
      ) : null}
    </>
  );
};
