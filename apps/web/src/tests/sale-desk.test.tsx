import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiRequest: vi.fn(),
  apiDownload: vi.fn(async () => undefined),
}));
import { apiDownload, apiRequest } from '../api/client.js';
import { buildSaleMenu } from '../App.js';
import { calcSheet, CashActivityScreen } from '../sale/CashActivityScreen.js';
import { CashCardUpdateScreen } from '../sale/CashCardUpdateScreen.js';
import { FbrRepostScreen } from '../sale/FbrRepostScreen.js';
import { SaleReportScreen } from '../sale/SaleReportScreen.js';
import { UserPcSerialScreen } from '../sale/UserPcSerialScreen.js';

const api = vi.mocked(apiRequest);
const LOOK = {
  shops: [{ id: 's1', code: 'FW', name: 'FACTORY WAREHOUSE', region: 'North' }],
  regions: ['North'],
  salesmen: ['Ali', 'Sara'],
  terminals: ['T1'],
  expenseHeads: ['Petty Expense'],
  receiptHeads: ['Other Receipt'],
  transferTypes: ['Bank Deposit'],
  customers: [{ id: 'c1', name: 'Ayesha Khan', phone: null }],
  today: '2026-11-10',
  timeZone: 'Asia/Karachi',
  currency: 'PKR',
};
const SHEET = {
  storeId: 's1',
  date: '2026-11-10',
  saved: false,
  closed: false,
  voucherNo: null,
  openingPettyCash: '1500.00',
  receivePettyCash: '0.00',
  creditCardSales: '12500.00',
  onAccountSales: '3000.00',
  cashSales: '48250.00',
  redemptionAmount: '500.00',
  totalSales: '64250.00',
  openingCash: '20000.00',
  expenseLines: [],
  receiptLines: [],
  transferLines: [],
  terminalLines: [],
  problems: [],
};
let calls: { path: string; method: string; body: unknown }[];
const route = (extra: (path: string, opts?: { method?: string; body?: unknown }) => unknown) => {
  api.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: opts?.method ?? 'GET', body: opts?.body });
    if (path === '/sale-desk/lookups') return LOOK;
    return extra(path, opts);
  });
};
const noop = () => undefined;

beforeEach(() => {
  calls = [];
  delete (window as { mafkDesktop?: unknown }).mafkDesktop;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  api.mockReset();
});

describe('Sale menu', () => {
  const user = (permissions: string[]) => ({
    id: 'u',
    tenantId: 't',
    loginId: 'x',
    displayName: 'X',
    systemRole: 'CASHIER',
    permissions,
  });
  it('lists only what the user may open, in the original order, without stray separators', () => {
    const all = buildSaleMenu(
      user([
        'cash_activity.view',
        'pos.view',
        'sale_reports.daily_closing',
        'card_update.view',
        'fbr_repost.view',
        'sale_reports.bill_wise',
        'sale_reports.sales_person',
        'pc_serial.view',
      ]),
    );
    const labels = all!.children!.map((c) => (c === 'separator' ? '|' : c.label));
    expect(labels).toEqual([
      'Daily Cash Activity',
      '|',
      'Point of Sale',
      '|',
      'Daily Sales Report',
      '|',
      'Cash and Credit Card Update',
      'FBR Repost Period',
      'Bill Wise Sales',
      'Sales Person Wise Sales Report',
      'User PC Serial',
    ]);
    expect(labels.join()).not.toMatch(/gift/i);
    const some = buildSaleMenu(user(['pos.view', 'pc_serial.view']));
    expect(some!.children!.map((c) => (c === 'separator' ? '|' : c.label))).toEqual([
      'Point of Sale',
      '|',
      'User PC Serial',
    ]);
    expect(buildSaleMenu(user(['customers.view']))).toBeNull();
  });
});

describe('Daily Cash Activity arithmetic', () => {
  it('derives every total from the lines', () => {
    const c = calcSheet(
      {
        openingPettyCash: '60.00',
        openingCash: '0.00',
        cashSales: '1699.00',
        creditCardSales: '899.00',
      },
      {
        receive: '500',
        expense: [{ amount: '200' }],
        receipt: [{ amount: '50' }],
        transfer: [{ amount: '1000' }],
        terminal: [{ settlement: '899' }],
      },
    );
    expect(c).toMatchObject({
      totalExpense: 20000,
      closingPetty: 36000,
      adjustment: 5000,
      totalAvailable: 174900,
      deposited: 100000,
      net: 74900,
    });
    expect(c.problems).toEqual([]);
    const bad = calcSheet(
      {
        openingPettyCash: '0.00',
        openingCash: '0.00',
        cashSales: '100.00',
        creditCardSales: '50.00',
      },
      {
        receive: '',
        expense: [{ amount: '10' }],
        receipt: [],
        transfer: [{ amount: '500' }],
        terminal: [{ settlement: '10' }],
      },
    );
    expect(bad.problems.map((p) => p.level)).toEqual(['error', 'error', 'warning']);
  });
});

describe('Daily Cash Activity screen', () => {
  it('shows the day, recalculates while typing, and saves / closes through the confirm dialog', async () => {
    route((path, opts) => {
      if (path.startsWith('/sale-desk/cash-activity') && opts?.method === 'PUT')
        return { ...SHEET, saved: true, closed: true, voucherNo: 'CV-FW-20261110' };
      if (path.startsWith('/sale-desk/cash-activity')) return SHEET;
      throw new Error(path);
    });
    const u = userEvent.setup();
    render(<CashActivityScreen onClose={noop} canSave canClear />);
    await screen.findByText('64,250.00');
    expect(screen.getByTestId('net-available').textContent).toBe('68,250.00');
    // an expense of 300 lowers the closing petty cash 1,500 -> 1,200
    await u.type(
      screen.getByLabelText('Expense Detail Expense Detail (new line)'),
      'Petty Expense',
    );
    await u.type(screen.getByLabelText('Expense Detail Amount 1'), '300');
    expect(screen.getByTestId('closing-petty').textContent).toBe('1,200.00');
    // a bank deposit lowers the net available cash
    await u.selectOptions(
      screen.getByLabelText('Fund Transfer Detail Transfer Type (new line)'),
      'Bank Deposit',
    );
    await u.type(screen.getByLabelText('Fund Transfer Detail Amount 1'), '8000');
    expect(screen.getByTestId('net-available').textContent).toBe('60,250.00');

    await u.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByTestId('confirm-save');
    await u.click(within(dialog).getByRole('button', { name: 'Save and close the day' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({
      storeId: 's1',
      date: '2026-11-10',
      close: true,
      expenseLines: [{ head: 'Petty Expense', amount: '300' }],
      transferLines: [{ type: 'Bank Deposit', amount: '8000' }],
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Closed') as HTMLInputElement).checked).toBe(true),
    );
    expect(
      (screen.getByLabelText('Expense Detail Amount (new line)') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Clear Closing' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: 'Voucher' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('refuses to save when deposits are more than the cash, and lists the problem under Error', async () => {
    route((path) =>
      path.startsWith('/sale-desk/cash-activity')
        ? SHEET
        : (() => {
            throw new Error(path);
          })(),
    );
    const u = userEvent.setup();
    render(<CashActivityScreen onClose={noop} canSave canClear />);
    await screen.findByText('64,250.00');
    await u.selectOptions(
      screen.getByLabelText('Fund Transfer Detail Transfer Type (new line)'),
      'Bank Deposit',
    );
    await u.type(screen.getByLabelText('Fund Transfer Detail Amount 1'), '999999');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    const dlg = await screen.findByTestId('problems');
    expect(dlg.textContent).toMatch(/more than the cash available/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('a closed day is read-only; a user without the right can only look', async () => {
    route((path) =>
      path.startsWith('/sale-desk/cash-activity')
        ? { ...SHEET, saved: true, closed: true, voucherNo: 'CV-FW-1' }
        : (() => {
            throw new Error(path);
          })(),
    );
    render(<CashActivityScreen onClose={noop} canSave={false} canClear={false} />);
    await screen.findByText(/This day is closed/);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Clear Closing' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Voucher No') as HTMLInputElement).value).toBe('CV-FW-1');
  });
});

describe('Cash and Credit Card Update screen', () => {
  const TENDER = {
    id: 'b1',
    invoiceNo: 'INV-1',
    storeName: 'FW',
    netReceivable: '899.00',
    cash: '0.00',
    card: '899.00',
    onAccount: '0.00',
    redemption: '0.00',
    customerId: null,
    customerName: null,
    terminal: 'T1',
    fbrInvoiceNo: '',
    lockedReason: null as string | null,
  };
  const setup = (tender = TENDER) =>
    route((path, opts) => {
      if (path.startsWith('/sale-desk/bills?'))
        return {
          items: [
            {
              id: 'b1',
              invoiceNo: 'INV-1',
              soldAt: '2026-11-10T08:00:00Z',
              customerName: null,
              grandTotal: '899.00',
              status: 'COMPLETED',
            },
          ],
        };
      if (path === '/sale-desk/bills/b1/tender' && opts?.method === 'PUT')
        return { ...tender, cash: '400.00', card: '499.00' };
      if (path === '/sale-desk/bills/b1/tender') return tender;
      throw new Error(path);
    });

  it('loads a bill from the list, only allows a split that adds up, and saves it', async () => {
    setup();
    const u = userEvent.setup();
    render(<CashCardUpdateScreen onClose={noop} />);
    await screen.findByLabelText('Shop');
    await u.click(screen.getByRole('button', { name: 'List' }));
    await u.click(await screen.findByRole('button', { name: /INV-1/ }));
    await waitFor(() => expect(screen.getByTestId('net-receivable').textContent).toBe('899.00'));
    const update = screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    // 400 cash + 899 card is too much -> blocked with an explanation
    const cash = screen.getByLabelText('Cash Amount');
    await u.clear(cash);
    await u.type(cash, '400');
    expect(update.disabled).toBe(true);
    expect(screen.getByText(/must equal the net receivable amount/)).toBeTruthy();
    const card = screen.getByLabelText('DR / CR Card Amount');
    await u.clear(card);
    await u.type(card, '499');
    expect(update.disabled).toBe(false);
    await u.click(update);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({
      cash: '400.00',
      card: '499.00',
      onAccount: '0.00',
      terminal: 'T1',
    });
    await screen.findByText(/Bill INV-1 updated/);
  });

  it('a locked bill shows why and cannot be changed', async () => {
    setup({
      ...TENDER,
      lockedReason:
        'The cash sheet of 2026-11-10 is closed. Clear the closing in Daily Cash Activity first.',
    });
    const u = userEvent.setup();
    render(<CashCardUpdateScreen onClose={noop} />);
    await screen.findByLabelText('Shop');
    await u.click(screen.getByRole('button', { name: 'List' }));
    await u.click(await screen.findByRole('button', { name: /INV-1/ }));
    await screen.findByText(/sheet of 2026-11-10 is closed/);
    expect((screen.getByLabelText('Cash Amount') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('Reports', () => {
  const RESULT = {
    meta: {
      from: '2026-11-10',
      to: '2026-11-10',
      shop: 'All shops',
      region: '',
      salesman: '',
      type: 'day-wise',
      currency: 'PKR',
      timeZone: 'Asia/Karachi',
    },
    table: {
      title: 'Sales Person Wise Sales - Day-wise',
      columns: [
        { key: 'salesman', label: 'Sales Person', align: 'left' },
        { key: 'net', label: 'Net Sales', align: 'right' },
      ],
      rows: [{ salesman: 'Ali', net: '1798.00' }],
      totals: { salesman: 'Total', net: '1798.00' },
    },
  };
  it('Sales Person Wise offers the five report types and sends the chosen one', async () => {
    route(() => RESULT);
    const u = userEvent.setup();
    render(<SaleReportScreen kind="person" onClose={noop} />);
    const type = (await screen.findByLabelText('Report Type')) as HTMLSelectElement;
    expect([...type.options].map((o) => o.text)).toEqual([
      'Day-wise',
      'Consolidated',
      'Shop-wise',
      'Cashier-wise',
      'Consolidated Summary',
    ]);
    await u.selectOptions(type, 'cashier-wise');
    await u.selectOptions(screen.getByLabelText('Sales Person'), 'Ali');
    await u.click(screen.getByRole('button', { name: 'Print A4' }));
    await screen.findByTestId('report-table');
    const url = calls.find((c) => c.path.startsWith('/sale-desk/reports/sales-person'))!.path;
    expect(url).toContain('type=cashier-wise');
    expect(url).toContain('salesman=Ali');
    expect(url).toContain('from=2026-11-10');
  });
  it('Print Slip shows the narrow slip and Excel downloads the CSV with the same filters', async () => {
    route(() => RESULT);
    const u = userEvent.setup();
    render(<SaleReportScreen kind="daily" onClose={noop} />);
    await screen.findByLabelText('Report Type');
    await u.click(screen.getByRole('button', { name: 'Print Slip' }));
    await screen.findByTestId('report-slip');
    await u.click(screen.getByRole('button', { name: 'Close' }));
    await u.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(vi.mocked(apiDownload)).toHaveBeenCalled());
    expect(vi.mocked(apiDownload).mock.calls[0]![0]).toMatch(/daily-closing\?.*format=csv/);
  });
  it('Bill Wise has Region and no sales-person filter; an empty result says so', async () => {
    route(() => ({ ...RESULT, table: { ...RESULT.table, rows: [], totals: null } }));
    const u = userEvent.setup();
    render(<SaleReportScreen kind="bill" onClose={noop} />);
    await u.selectOptions(await screen.findByLabelText('Region'), 'North');
    expect(screen.queryByLabelText('Sales Person')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByTestId('report-empty');
    expect(calls.find((c) => c.path.includes('bill-wise'))!.path).toContain('region=North');
  });
});

describe('FBR Repost Period screen', () => {
  it('posts only the numbers that were typed', async () => {
    const row = {
      id: 'b1',
      invoiceNo: 'INV-1',
      date: '2026-11-10',
      storeName: 'FW',
      customerName: null,
      grandTotal: '899.00',
      taxTotal: '130.00',
      fbrInvoiceNo: '',
      status: 'PENDING',
    };
    route((path, opts) => {
      if (path.startsWith('/sale-desk/fbr/repost')) return { updated: 1 };
      if (path.startsWith('/sale-desk/fbr'))
        return { items: [row, { ...row, id: 'b2', invoiceNo: 'INV-2' }], pending: 2 };
      throw new Error(`${path} ${opts?.method}`);
    });
    const u = userEvent.setup();
    render(<FbrRepostScreen onClose={noop} canEdit />);
    const box = await screen.findByLabelText('FBR invoice number of INV-1');
    expect((screen.getByRole('button', { name: 'Repost' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await u.type(box, 'FBR-77');
    await u.click(screen.getByRole('button', { name: 'Repost' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      items: [{ saleId: 'b1', fbrInvoiceNo: 'FBR-77' }],
    });
  });
});

describe('User PC Serial screen', () => {
  const USERS = {
    items: [
      {
        id: 'u1',
        loginId: 'faraz',
        displayName: 'FARAZ AHMED',
        systemRole: 'CASHIER',
        status: 'ACTIVE',
        pcSerial: null,
      },
      {
        id: 'u2',
        loginId: 'bilal',
        displayName: 'Bilal',
        systemRole: 'CASHIER',
        status: 'ACTIVE',
        pcSerial: 'PF2ABC12',
      },
    ],
  };
  const setup = () =>
    route((path, opts) => {
      if (opts?.method === 'PUT')
        return {
          ...USERS.items[0],
          pcSerial: (opts.body as { serial: string }).serial.toUpperCase() || null,
        };
      if (path === '/sale-desk/pc-serials') return USERS;
      throw new Error(path);
    });

  it("Get Serial fills this PC's serial and Update Serial binds the chosen user to it", async () => {
    (window as { mafkDesktop?: unknown }).mafkDesktop = {
      isDesktop: true,
      apiBase: '/api',
      getSerial: vi.fn(async () => 'PC-SERIAL-9'),
    };
    setup();
    const u = userEvent.setup();
    render(<UserPcSerialScreen onClose={noop} canEdit />);
    await u.click(screen.getByRole('button', { name: 'List' }));
    await u.click(await screen.findByRole('button', { name: /FARAZ AHMED/ }));
    expect((screen.getByLabelText('User PC Serial #') as HTMLInputElement).value).toBe('-');
    await u.click(screen.getByRole('button', { name: 'Get Serial' }));
    await waitFor(() =>
      expect((screen.getByLabelText('User PC Serial #') as HTMLInputElement).value).toBe(
        'PC-SERIAL-9',
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Update Serial' }));
    await screen.findByText(/can now sign in only from the PC with serial PC-SERIAL-9/);
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/sale-desk/pc-serials/u1',
      body: { serial: 'PC-SERIAL-9' },
    });
  });

  it('"-" releases the ID; in a browser Get Serial explains it needs the desktop app; Update needs a user', async () => {
    setup();
    const u = userEvent.setup();
    render(<UserPcSerialScreen onClose={noop} canEdit />);
    expect(
      (screen.getByRole('button', { name: 'Update Serial' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Get Serial' }));
    await screen.findByText(/works in the desktop app/);
    await u.click(screen.getByRole('button', { name: 'List' }));
    await u.click(await screen.findByRole('button', { name: /Bilal/ }));
    expect((screen.getByLabelText('User PC Serial #') as HTMLInputElement).value).toBe('PF2ABC12');
    const box = screen.getByLabelText('User PC Serial #');
    await u.clear(box);
    await u.type(box, '-');
    await u.click(screen.getByRole('button', { name: 'Update Serial' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ serial: '' });
  });
});
