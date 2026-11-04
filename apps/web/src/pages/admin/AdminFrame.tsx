import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { ErrorBanner } from '../../components/ui/ErrorBanner.js';
import { ApiError } from '../../api/client.js';

export const errText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

export const selectClass =
  'focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

/** Common frame of an Administrator form: title, optional notice/error, and an Exit button back to the menu. */
export const AdminFrame = ({
  title,
  onExit,
  error,
  notice,
  children,
}: {
  title: string;
  onExit: () => void;
  error?: string | null;
  notice?: string | null;
  children: ReactNode;
}) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
      <Button variant="secondary" onClick={onExit}>
        <LogOut size={14} /> Exit
      </Button>
    </div>
    {error ? <ErrorBanner message={error} /> : null}
    {notice ? (
      <div
        role="status"
        className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
      >
        {notice}
      </div>
    ) : null}
    {children}
  </div>
);

export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={`py-2 pr-4 ${right ? 'text-right' : ''}`}>{children}</th>
);
export const headRow =
  'border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400';
export const bodyRow = 'border-b border-slate-100 dark:border-slate-800';
