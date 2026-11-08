import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosPage } from '../pages/PosPage.js';
import type { PosProduct, SaleDetail } from '../api/types.js';

/** Reference-style POS: bills list, sales return, free item, card reference, notes, hotkeys. */

const shirt: PosProduct = {
  id: 'p1',
  name: 'Cotton Shirt',
  sku: 'SHIRT-1',
  barcodes: ['111222'],
  unit: 'pcs',
  sellingPrice: '150.00',
  taxRate: '0',
  stock: '20.000',
};

const bill: SaleDetail = {
  id: 'sale1',
  storeId: 's1',
  invoiceNo: 'INV-MAIN-000001',
  status: 'COMPLETED',
  grandTotal: '300.00',
  paidTotal: '300.00',
  changeDue: '0.00',
  customerId: null,
  customerName: null,
  soldAt: '2026-11-08T10:00:00.000Z',
  subtotal: '300.00',
  itemDiscountTotal: '0.00',
  cartDiscountPercent: '0',
  cartDiscountAmount: '0.00',
  taxTotal: '0.00',
  notes: null,
  items: [
    {
      id: 'si1',
      productId: 'p1',
      productName: 'Cotton Shirt',
      sku: 'SHIRT-1',
      quantity: '2.000',
      returnedQuantity: '0.000',
      unitPrice: '150.00',
      discountPercent: '0',
      discountAmount: '0.00',
      taxRate: '0',
      taxAmount: '0.00',
      lineTotal: '300.00',
    },
  ],
  payments: [],
  returns: [],
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let calls: Call[] = [];
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = url.pathname.replace(/^\/api/, '') + url.search;
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      if (path.startsWith('/pos/products')) return json(200, { items: [shirt] });
      if (path.startsWith('/sales?'))
        return json(200, { items: [bill], total: 1, page: 1, pageSize: 30 });
      if (path === '/sales/sale1') return json(200, bill);
      if (path === '/vouchers/CM-1')
        return json(200, {
          id: 'v1',
          code: 'CM-1',
          kind: 'CREDIT_MEMO',
          amount: '500.00',
          balance: '500.00',
          status: 'ACTIVE',
          expiresAt: null,
          note: null,
          createdAt: '2026-11-08T00:00:00Z',
        });
      if (path === '/vouchers/DV-1')
        return json(200, {
          id: 'v2',
          code: 'DV-1',
          kind: 'DISCOUNT',
          amount: '50.00',
          balance: '50.00',
          status: 'ACTIVE',
          expiresAt: null,
          note: null,
          createdAt: '2026-11-08T00:00:00Z',
        });
      if (path.startsWith('/vouchers?'))
        return json(200, { items: [], total: 0, page: 1, pageSize: 30 });
      if (path === '/sales' && method === 'POST') return json(201, { ...bill, id: 'sale2' });
      if (path === '/sales/sale1/returns' && method === 'POST')
        return json(201, { id: 'ret1', saleId: 'sale1', returnNo: 'RET-1', items: [] });
      if (path.includes('/receipt')) return json(404, { error: { code: 'X', message: 'n/a' } });
      return json(404, { error: { code: 'NOT_FOUND', message: `unrouted ${path}` } });
    }),
  );
});
afterEach(() => cleanup());

describe('reference POS', () => {
  it('shows the reference toolbar; integration-only buttons are disabled with a reason', () => {
    render(<PosPage storeId="s1" storeName="Main Branch" />);
    for (const name of ['Post Fbr', 'Repost', 'Print Airway Bill']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.title).toMatch(/not connected/);
    }
    expect((screen.getByLabelText('Shop') as HTMLInputElement).value).toBe('Main Branch');
  });

  it('a free item is sent as a 100% discount and refs/salesman/card details travel with the sale', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.type(screen.getByLabelText('Sales Man'), 'Ali');
    await user.type(screen.getByLabelText('Order Ref #'), 'ORD-9');
    await user.click(screen.getByLabelText('Free Item'));
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('(free)');
    expect(screen.getByTestId('grand-total').textContent).toBe('0.00');
    await user.click(screen.getByLabelText('Free Item'));
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await user.type(screen.getByLabelText('Card'), '150');
    await user.type(screen.getByLabelText('Card #'), '4111');
    await user.type(screen.getByLabelText('Approval'), '778');
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales' && c.method === 'POST')).toBe(true),
    );
    const post = calls.find((c) => c.path === '/sales' && c.method === 'POST')!;
    const items = post.body!.items as Record<string, unknown>[];
    expect(items.some((i) => i.discountPercent === '100')).toBe(true);
    expect(post.body!.orderRef).toBe('ORD-9');
    expect(items.every((i) => i.salesman === 'Ali')).toBe(true);
    expect((post.body!.payments as Record<string, unknown>[])[0]).toMatchObject({
      method: 'CARD',
      reference: '4111 A:778',
    });
  });

  it('Bills lists past bills and picking one in Sales Return mode returns the chosen quantity', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.selectOptions(screen.getByLabelText('Sales Type'), 'RETURN');
    await user.click(screen.getByRole('button', { name: 'Pick bill' }));
    await user.click(await screen.findByRole('button', { name: /INV-MAIN-000001/ }));
    await screen.findByLabelText('Return quantity Cotton Shirt');
    await user.type(screen.getByLabelText('Return quantity Cotton Shirt'), '5');
    expect(await screen.findByText(/cannot return more/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Process return' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.clear(screen.getByLabelText('Return quantity Cotton Shirt'));
    await user.type(screen.getByLabelText('Return quantity Cotton Shirt'), '1');
    await user.type(screen.getByLabelText('Return Reason'), 'Wrong size');
    await user.click(screen.getByRole('button', { name: 'Process return' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/sales/sale1/returns')).toBe(true));
    const post = calls.find((c) => c.path === '/sales/sale1/returns')!;
    expect(post.body).toMatchObject({
      items: [{ saleItemId: 'si1', quantity: '1' }],
      refundMethod: 'CASH',
      reason: 'Wrong size',
    });
  });

  it('un-ticking Partial Return locks the quantities to everything left on the bill', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.selectOptions(screen.getByLabelText('Sales Type'), 'RETURN');
    await user.click(screen.getByRole('button', { name: 'Pick bill' }));
    await user.click(await screen.findByRole('button', { name: /INV-MAIN-000001/ }));
    await user.click(await screen.findByLabelText('Partial Return'));
    const q = screen.getByLabelText('Return quantity Cotton Shirt') as HTMLInputElement;
    expect(q.disabled).toBe(true);
    expect(q.value).toBe('2.000');
  });

  it('Alt+S saves the bill and F2 opens Check Stock', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('Cotton Shirt');
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    fireEvent.keyDown(window, { key: 's', altKey: true });
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales' && c.method === 'POST')).toBe(true),
    );
    fireEvent.keyDown(window, { key: 'F2' });
    expect(await screen.findByLabelText('Check stock')).toBeTruthy();
  });

  it('service fee, other charges, a discount voucher and rounding change the amount due and travel with the sale', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" canIssueVoucher />);
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('Cotton Shirt'); // 150.00
    await user.type(screen.getByLabelText('Service Fee'), '5.50');
    await user.type(screen.getByLabelText('Add Other Charges'), '2.25');
    await user.type(screen.getByLabelText('Disc Voucher #'), 'dv-1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByTestId('voucher-msg')).textContent).toMatch(/50\.00 available/);
    // 150 + 5.50 + 2.25 - 50 = 107.75; rounding off
    expect(screen.getByTestId('grand-total').textContent).toBe('107.75');
    await user.click(screen.getByLabelText('Round Not Apply'));
    expect(screen.getByTestId('grand-total').textContent).toBe('108.00');
    await user.click(screen.getByRole('button', { name: 'Exact cash' }));
    await user.click(screen.getByRole('button', { name: 'Complete sale' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/sales' && c.method === 'POST')).toBe(true),
    );
    const post = calls.find((c) => c.path === '/sales' && c.method === 'POST')!;
    expect(post.body).toMatchObject({
      serviceFee: '5.50',
      otherCharges: '2.25',
      roundToWhole: true,
      discountVoucherCode: 'DV-1',
    });
  });

  it('a credit memo larger than the bill only takes what is due, and a bad code is explained', async () => {
    const user = userEvent.setup();
    render(<PosPage storeId="s1" />);
    await user.type(screen.getByLabelText(/scan barcode or search product/i), '111222{enter}');
    await screen.findByText('Cotton Shirt');
    await user.type(screen.getByLabelText('Credit Memo #'), 'cm-1');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(screen.getByTestId('grand-total').textContent).toBe('0.00'));
    expect(
      (screen.getByRole('button', { name: 'Complete sale' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.clear(screen.getByLabelText('Credit Memo #'));
    await user.type(screen.getByLabelText('Credit Memo #'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect((await screen.findByTestId('voucher-msg')).textContent).toMatch(
      /unrouted|not found|NOT_FOUND/i,
    );
    expect(screen.getByTestId('grand-total').textContent).toBe('150.00');
  });

  it('Vouchers opens the issue form only for users who may issue', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PosPage storeId="s1" />);
    await user.click(screen.getByRole('button', { name: 'Vouchers' }));
    expect(await screen.findByRole('dialog', { name: 'Vouchers' })).toBeTruthy();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    unmount();
    cleanup();
    render(<PosPage storeId="s1" canIssueVoucher />);
    await user.click(screen.getByRole('button', { name: 'Vouchers' }));
    expect(await screen.findByLabelText('Amount')).toBeTruthy();
  });
});
