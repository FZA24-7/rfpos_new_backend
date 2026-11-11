import { useEffect, useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { X, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * A classic "form window" (title bar, grouped fields, icon buttons) used by every Sale screen, drawn with the app's
 * own look so it works in light and dark mode. `onClose` is what the title-bar X and every Exit/Close button call.
 */
export const DeskWindow = ({
  title,
  icon: Icon,
  onClose,
  width = 'max-w-lg',
  children,
  footer,
  testId,
}: {
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) => (
  <section
    aria-label={title}
    data-testid={testId}
    className={`mx-auto w-full ${width} overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 desk-window-in`}
  >
    <header className="flex items-center gap-2.5 bg-gradient-to-r from-slate-900 via-slate-800 to-brand-700 px-3.5 py-2 text-white">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/15">
        <Icon size={14} aria-hidden />
      </span>
      <h2 className="flex-1 truncate text-sm font-semibold tracking-wide">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title}`}
        className="focus-ring flex h-6 w-8 items-center justify-center rounded text-white/80 transition-colors hover:bg-red-500 hover:text-white"
      >
        <X size={15} />
      </button>
    </header>
    <div className="p-4">{children}</div>
    {footer ? (
      <footer className="border-t border-slate-200 bg-white/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        {footer}
      </footer>
    ) : null}
  </section>
);

type Tone = 'default' | 'primary' | 'danger' | 'success';
const toneRing: Record<Tone, string> = {
  default:
    'from-amber-50 to-amber-100 text-amber-700 ring-amber-200 dark:from-slate-800 dark:to-slate-700 dark:text-amber-300 dark:ring-slate-600',
  primary:
    'from-sky-50 to-sky-100 text-brand-600 ring-sky-200 dark:from-slate-800 dark:to-slate-700 dark:text-sky-300 dark:ring-slate-600',
  danger:
    'from-rose-50 to-rose-100 text-rose-600 ring-rose-200 dark:from-slate-800 dark:to-slate-700 dark:text-rose-300 dark:ring-slate-600',
  success:
    'from-emerald-50 to-emerald-100 text-emerald-600 ring-emerald-200 dark:from-slate-800 dark:to-slate-700 dark:text-emerald-300 dark:ring-slate-600',
};

/** The big icon-over-caption buttons of the toolbar. */
export const ToolButton = ({
  icon: Icon,
  label,
  tone = 'default',
  ...props
}: { icon: LucideIcon; label: string; tone?: Tone } & Omit<
  ComponentPropsWithoutRef<'button'>,
  'children'
>) => (
  <button
    type="button"
    {...props}
    className="focus-ring group flex w-[4.4rem] flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium leading-tight text-slate-700 transition enabled:hover:-translate-y-0.5 enabled:hover:bg-white enabled:hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 enabled:dark:hover:bg-slate-800"
  >
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-b ring-1 transition group-enabled:group-hover:scale-105 ${toneRing[tone]}`}
    >
      <Icon size={20} aria-hidden />
    </span>
    <span className="text-center">{label}</span>
  </button>
);

/** `Label ........ [control]` row. `wide` gives the label column more room. */
export const Row = ({
  label,
  htmlFor,
  children,
  tone = 'default',
  labelWidth = 'w-32',
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  tone?: 'default' | 'brown' | 'green' | 'blue' | 'red';
  labelWidth?: string;
}) => {
  const toneClass = {
    default: 'text-slate-800 dark:text-slate-200',
    brown: 'text-amber-800 dark:text-amber-400',
    green: 'text-emerald-700 dark:text-emerald-400',
    blue: 'text-blue-800 dark:text-sky-300',
    red: 'text-red-700 dark:text-red-400',
  }[tone];
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={htmlFor}
        className={`${labelWidth} shrink-0 text-[13px] font-semibold ${toneClass}`}
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
};

const fieldBase =
  'focus-ring h-8 w-full min-w-0 rounded-md border px-2.5 text-sm text-slate-900 dark:text-slate-100 disabled:cursor-not-allowed';
export const DeskInput = ({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) => (
  <input
    {...props}
    className={`${fieldBase} border-slate-300 bg-white placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:disabled:bg-slate-800/60 ${className}`}
  />
);
export const DeskSelect = ({
  className = '',
  children,
  ...props
}: ComponentPropsWithoutRef<'select'>) => (
  <select
    {...props}
    className={`${fieldBase} border-slate-300 bg-white disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:disabled:bg-slate-800/60 ${className}`}
  >
    {children}
  </select>
);

/** A read-only figure (light-blue / grey box, right aligned) as in the original forms. */
export const NumBox = ({
  value,
  label,
  strong = false,
  testId,
}: {
  value: string;
  label: string;
  strong?: boolean;
  testId?: string;
}) => (
  <output
    aria-label={label}
    data-testid={testId}
    className={`flex h-8 w-full min-w-0 items-center justify-end rounded-md border border-slate-200 bg-sky-50/80 px-2.5 text-sm tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 ${strong ? 'font-bold' : ''}`}
  >
    {value}
  </output>
);

/** The black box with big green digits. */
export const Lcd = ({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId?: string;
}) => (
  <output
    aria-label={label}
    data-testid={testId}
    className="flex h-9 w-full min-w-0 items-center justify-end rounded-md bg-black px-3 font-mono text-xl font-bold tabular-nums text-lime-400 shadow-inner ring-1 ring-slate-700"
  >
    {value}
  </output>
);

export const SmallButton = ({
  className = '',
  tone = 'default',
  ...props
}: ComponentPropsWithoutRef<'button'> & { tone?: 'default' | 'primary' }) => (
  <button
    type="button"
    {...props}
    className={`focus-ring h-8 shrink-0 rounded-md border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      tone === 'primary'
        ? 'border-brand-500 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-sky-500 dark:bg-slate-800 dark:text-sky-300'
        : 'border-slate-300 bg-slate-100 text-slate-800 hover:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
    } ${className}`}
  />
);

export const LookupButton = ({
  label,
  ...props
}: { label: string } & ComponentPropsWithoutRef<'button'>) => (
  <button
    type="button"
    aria-label={label}
    {...props}
    className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-brand-600 transition-colors hover:bg-sky-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300"
  >
    <Search size={15} />
  </button>
);

/** Centered dialog over the screen (pickers, confirmations, report preview). Esc closes it. */
export const DeskModal = ({
  title,
  onClose,
  children,
  width = 'max-w-xl',
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  testId?: string;
}) => {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className={`desk-window-in w-full ${width} overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900`}
      >
        <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-brand-700 px-4 py-2.5 text-white">
          <h3 id={titleId} className="text-sm font-semibold">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="focus-ring rounded p-1 text-white/80 hover:bg-white/15"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const InlineMessage = ({
  kind,
  children,
}: {
  kind: 'error' | 'ok' | 'info' | 'warn';
  children: ReactNode;
}) => {
  const cls = {
    error:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-300',
    warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-[13px] ${cls}`}
    >
      {children}
    </div>
  );
};
