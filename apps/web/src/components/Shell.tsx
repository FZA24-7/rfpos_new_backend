import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../state/auth.js';
import { Button } from './ui/Button.js';

const getInitialDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export interface NavItem {
  key: string;
  label: string;
  /** A drop-down menu (like Sale): the items inside, with 'separator' for a divider line. */
  children?: (NavItem | 'separator')[];
}

const flatKeys = (item: NavItem): string[] =>
  (item.children ?? []).flatMap((c) => (c === 'separator' ? [] : [c.key, ...flatKeys(c)]));

const NavGroup = ({
  item,
  activeNavKey,
  onNavigate,
}: {
  item: NavItem;
  activeNavKey?: string | undefined;
  onNavigate?: ((key: string) => void) | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = !!activeNavKey && flatKeys(item).includes(activeNavKey);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`focus-ring inline-flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          active || open
            ? 'bg-brand-600 text-white'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        {item.label}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={item.label}
          className="desk-window-in absolute left-0 top-full z-40 mt-1 min-w-[17rem] overflow-hidden rounded-lg border border-slate-300 bg-white py-1 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          {(item.children ?? []).map((c, i) =>
            c === 'separator' ? (
              <div
                key={`s${i}`}
                role="separator"
                className="my-1 border-t border-slate-200 dark:border-slate-700"
              />
            ) : (
              <button
                key={c.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.(c.key);
                }}
                className={`focus-ring block w-full px-5 py-2 text-left text-sm transition-colors hover:bg-brand-600 hover:text-white ${
                  activeNavKey === c.key
                    ? 'bg-sky-50 font-semibold text-brand-700 dark:bg-slate-800 dark:text-sky-300'
                    : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {c.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
};

export const Shell = ({
  children,
  nav,
  activeNavKey,
  onNavigate,
}: {
  children: ReactNode;
  nav?: NavItem[];
  activeNavKey?: string;
  onNavigate?: (key: string) => void;
}) => {
  const { user, logout } = useAuth();
  const [dark, setDark] = useState(getInitialDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="fza-app min-h-screen">
      <header className="fza-header no-print border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/fza-logo.png" alt="" aria-hidden="true" className="fza-logo" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">FZA Retail-POS</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {user?.client ? `${user.client.name} (${user.client.code})` : 'Master Admin'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <span className="text-sm text-slate-600 dark:text-slate-300">{user.displayName}</span>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="secondary" onClick={() => void logout()}>
              <LogOut size={14} /> Sign out
            </Button>
          </div>
        </div>
        {nav && nav.length > 0 ? (
          <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 pb-2">
            {nav.map((item) =>
              item.children ? (
                <NavGroup
                  key={item.key}
                  item={item}
                  activeNavKey={activeNavKey}
                  onNavigate={onNavigate}
                />
              ) : (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate?.(item.key)}
                  className={`focus-ring whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeNavKey === item.key
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              ),
            )}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
};
