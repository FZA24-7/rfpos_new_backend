import { FileSpreadsheet } from 'lucide-react';
import { DocPreview } from './DocPreview.js';
import type { PaperSize } from './DocPreview.js';
import { ymdDisplay } from './deskApi.js';

export interface ReportColumn {
  key: string;
  label: string;
  align: 'left' | 'right';
}
export interface ReportResult {
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
  table: {
    title: string;
    columns: ReportColumn[];
    rows: Record<string, string | number>[];
    totals: Record<string, string | number> | null;
  };
}

const money = (v: string | number | undefined): string => {
  const s = String(v ?? '');
  return /^-?\d+\.\d{2}$/.test(s)
    ? Number(s).toLocaleString('en-US', { minimumFractionDigits: 2 })
    : s;
};

const Header = ({ r }: { r: ReportResult }) => (
  <div className="mb-3 border-b border-slate-300 pb-2">
    <h2 className="text-base font-bold">{r.table.title}</h2>
    <p>
      {ymdDisplay(r.meta.from)} to {ymdDisplay(r.meta.to)} · {r.meta.shop}
      {r.meta.region ? ` · Region: ${r.meta.region}` : ''}
      {r.meta.salesman ? ` · Sales person: ${r.meta.salesman}` : ''}
    </p>
  </div>
);

/** The report as it is shown and printed: an A4 table, or a narrow 80 mm slip. */
export const ReportViewer = ({
  report,
  paper,
  onClose,
  onExcel,
}: {
  report: ReportResult;
  paper: PaperSize;
  onClose: () => void;
  onExcel?: () => void;
}) => {
  const { columns, rows, totals } = report.table;
  const effectivePaper: PaperSize =
    paper === 'slip' ? 'slip' : columns.length > 8 ? 'a4-landscape' : 'a4';
  return (
    <DocPreview
      title={report.table.title}
      paper={effectivePaper}
      onClose={onClose}
      extraActions={
        onExcel ? (
          <button
            type="button"
            onClick={onExcel}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
        ) : null
      }
    >
      <Header r={report} />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-slate-500" data-testid="report-empty">
          No sales found for this selection.
        </p>
      ) : paper === 'slip' ? (
        <div data-testid="report-slip">
          {rows.map((row, i) => (
            <div key={i} className="mb-2 border-b border-dashed border-slate-400 pb-1.5">
              {columns.map((c, ci) => (
                <div
                  key={c.key}
                  className={`flex justify-between gap-2 ${ci === 0 ? 'font-bold' : ''}`}
                >
                  <span>{ci === 0 ? '' : `${c.label}`}</span>
                  <span>{money(row[c.key])}</span>
                </div>
              ))}
            </div>
          ))}
          {totals ? (
            <div className="mt-1 font-bold">
              {columns.map((c) => (
                <div key={c.key} className="flex justify-between gap-2">
                  <span>{c.label}</span>
                  <span>{money(totals[c.key])}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <table className="w-full border-collapse text-[11px]" data-testid="report-table">
          <thead>
            <tr className="bg-slate-100">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`border border-slate-300 px-1.5 py-1 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border border-slate-200 px-1.5 py-0.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {money(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr className="bg-slate-200 font-bold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border border-slate-300 px-1.5 py-1 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {money(totals[c.key])}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}
    </DocPreview>
  );
};
