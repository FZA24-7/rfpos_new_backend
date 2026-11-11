import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client.js';

export interface DeskShop {
  id: string;
  code: string;
  name: string;
  region: string | null;
}
export interface Lookups {
  shops: DeskShop[];
  regions: string[];
  salesmen: string[];
  terminals: string[];
  expenseHeads: string[];
  receiptHeads: string[];
  transferTypes: string[];
  customers: { id: string; name: string; phone: string | null }[];
  today: string;
  timeZone: string;
  currency: string;
}

export const errText = (e: unknown): string =>
  e instanceof ApiError || e instanceof Error
    ? e.message
    : 'Something went wrong. Please try again.';

/** Drop-down data shared by every Sale screen. `reload` refreshes it (e.g. after a region was changed). */
export const useLookups = () => {
  const [data, setData] = useState<Lookups | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Lookups>('/sale-desk/lookups'));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
};

// ── money helpers (whole cents as integers, so typing 0.1 + 0.2 never shows 0.30000000000000004) ──
export const toCents = (v: string | undefined | null): number => {
  const s = (v ?? '').trim();
  if (!s) return 0;
  const neg = s.startsWith('-');
  const [w = '0', f = ''] = s.replace('-', '').split('.');
  const c = Number(w || '0') * 100 + Number((f + '00').slice(0, 2));
  return neg ? -c : c;
};
export const fromCents = (c: number): string => {
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
/** 1234.5 -> "1,234.50" */
export const fmt = (v: string | number | undefined | null): string => {
  const c = typeof v === 'number' ? Math.round(v * 100) : toCents(v);
  const neg = c < 0;
  const a = Math.abs(c);
  const whole = Math.floor(a / 100).toLocaleString('en-US');
  return `${neg ? '-' : ''}${whole}.${String(a % 100).padStart(2, '0')}`;
};
/** Keeps what the person types a valid amount: digits and at most 2 decimals. */
export const cleanAmount = (raw: string): string => {
  const s = raw.replace(/[^\d.]/g, '');
  const [w = '', ...rest] = s.split('.');
  return rest.length > 0 ? `${w}.${rest.join('').slice(0, 2)}` : w;
};
export const toNumberString = (v: string): string =>
  v.trim() === '' ? '0' : v.trim().replace(/\.$/, '');

export const ymdDisplay = (ymd: string): string => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}/${m}/${y}` : ymd;
};
