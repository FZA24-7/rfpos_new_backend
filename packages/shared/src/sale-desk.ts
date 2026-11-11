/** Constants shared by the Sale menu screens (web) and their API. */

export const SALES_PERSON_REPORT_TYPES = [
  { value: 'day-wise', label: 'Day-wise' },
  { value: 'consolidated', label: 'Consolidated' },
  { value: 'shop-wise', label: 'Shop-wise' },
  { value: 'cashier-wise', label: 'Cashier-wise' },
  { value: 'consolidated-summary', label: 'Consolidated Summary' },
] as const;
export type SalesPersonReportType = (typeof SALES_PERSON_REPORT_TYPES)[number]['value'];

export const DETAIL_REPORT_TYPES = [
  { value: 'summary', label: 'Summary' },
  { value: 'detail', label: 'Detail' },
] as const;
export type DetailReportType = (typeof DETAIL_REPORT_TYPES)[number]['value'];

/** Starter lists for the drop-downs of Daily Cash Activity; anything already used by the business is added to them. */
export const DEFAULT_EXPENSE_HEADS = [
  'Petty Expense',
  'Conveyance',
  'Tea & Refreshment',
  'Stationery',
  'Utilities',
  'Repairs & Maintenance',
  'Staff Welfare',
  'Miscellaneous',
] as const;
export const DEFAULT_RECEIPT_HEADS = [
  'Other Receipt',
  'Scrap Sale',
  'Cash Excess',
  'Miscellaneous Income',
] as const;
export const FUND_TRANSFER_TYPES = [
  'Bank Deposit',
  'Head Office Transfer',
  'Shop to Shop Transfer',
  'Owner Withdrawal',
] as const;

/** Header the desktop app adds to every request so the API knows which PC the sign-in comes from. */
export const PC_SERIAL_HEADER = 'x-mafk-pc-serial';
export const MAX_PC_SERIAL_LENGTH = 80;
/** Normal form of a serial: trimmed, upper-case. "-" and "" mean "not bound to any PC". */
export const normalizePcSerial = (raw: string | null | undefined): string | null => {
  const v = (raw ?? '').trim().toUpperCase();
  return v === '' || v === '-' ? null : v.slice(0, MAX_PC_SERIAL_LENGTH);
};
