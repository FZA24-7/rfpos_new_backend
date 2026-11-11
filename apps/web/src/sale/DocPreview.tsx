import { Printer, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { DeskModal } from './DeskWindow.js';

export type PaperSize = 'a4' | 'a4-landscape' | 'slip';

/** Applies the paper size to the browser's print dialog while the document is printed. */
export const printDocument = (paper: PaperSize): void => {
  const style = document.createElement('style');
  style.textContent =
    paper === 'slip'
      ? '@page { size: 80mm auto; margin: 2mm; }'
      : paper === 'a4-landscape'
        ? '@page { size: A4 landscape; margin: 10mm; }'
        : '@page { size: A4; margin: 12mm; }';
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
};

/** Preview of a printable document (everything inside `#desk-print` is what gets printed). */
export const DocPreview = ({
  title,
  paper,
  onClose,
  children,
  extraActions,
}: {
  title: string;
  paper: PaperSize;
  onClose: () => void;
  children: ReactNode;
  extraActions?: ReactNode;
}) => (
  <DeskModal
    title={title}
    onClose={onClose}
    width={paper === 'slip' ? 'max-w-sm' : 'max-w-6xl'}
    testId="doc-preview"
  >
    <div className="no-print flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      {extraActions}
      <button
        type="button"
        onClick={() => printDocument(paper)}
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-[13px] font-medium text-white hover:bg-brand-700"
      >
        <Printer size={14} /> Print {paper === 'slip' ? 'slip' : 'A4'}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <X size={14} /> Close
      </button>
    </div>
    <div className="max-h-[75vh] overflow-auto bg-slate-100 p-4 dark:bg-slate-950">
      <div
        id="desk-print"
        className={`mx-auto bg-white p-5 text-[12px] text-slate-900 shadow ${paper === 'slip' ? 'w-[76mm] font-mono text-[11px]' : 'min-w-[640px]'}`}
      >
        {children}
      </div>
    </div>
  </DeskModal>
);
