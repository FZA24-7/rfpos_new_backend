import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthUser } from '../api/types.js';

let currentUser: AuthUser;
vi.mock('../state/auth.js', () => ({ useAuth: () => ({ user: currentUser }) }));
const { SecurityFilePage } = await import('../pages/admin/SecurityFilePage.js');

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}
let calls: Call[] = [];
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const registry = {
  rights: ['access', 'add', 'edit', 'delete'],
  baseline: [],
  modules: [
    {
      key: 'SALE',
      prefix: 'SALE',
      name: 'SALE',
      items: [{ key: 'POS', name: 'POS', kind: 'form', rights: ['access', 'add'], uses: [] }],
    },
  ],
};
const detail = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  loginId: 'cashier1',
  displayName: 'Ali Cashier',
  status: 'ACTIVE',
  systemRole: 'CUSTOM',
  storeId: null,
  storeName: null,
  categoryName: null,
  lastLoginAt: null,
  profile: {
    fbrPosId: null,
    macAddress: null,
    userCategoryId: null,
    counterPos: null,
    port: null,
    pcSerial: null,
    fbrTokenSet: false,
    fbrTokenHint: null,
  },
  rights: { modules: [], items: {} },
  rightsSource: 'saved',
  rightsEditable: true,
  effectivePermissions: [],
  ...over,
});
const row = (d: ReturnType<typeof detail>) => ({
  id: d.id,
  loginId: d.loginId,
  displayName: d.displayName,
  status: d.status,
  systemRole: d.systemRole,
  storeName: null,
  categoryName: null,
  lastLoginAt: null,
});

const asUser = (permissions: string[], tenantId: string | null): AuthUser =>
  ({
    id: 'me',
    loginId: 'me',
    displayName: 'Me',
    tenantId,
    systemRole: tenantId ? 'CLIENT_MASTER_ADMIN' : 'MASTER_ADMIN',
    permissions,
  }) as unknown as AuthUser;

const install = (user: ReturnType<typeof detail>, loginIdEditable = false) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), 'http://x').pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      if (path.endsWith('/registry')) return json(200, registry);
      if (path.endsWith('/lookups') || path.endsWith('/security/lookups'))
        return json(200, { categories: [], locations: [] });
      if (path.endsWith('/login-id/edit-state')) return json(200, { editable: loginIdEditable });
      if (path.endsWith('/login-id') && method === 'PATCH')
        return json(200, { loginId: 'renamed' });
      if (path.endsWith('/users') && method === 'GET') return json(200, [row(user)]);
      if (path.endsWith(`/users/${user.id}`) && method === 'GET') return json(200, user);
      if (path.endsWith(`/users/${user.id}`) && method === 'PATCH')
        return json(200, {
          ...user,
          ...body,
          loginId: 'renamed',
          rights: body?.rights ?? user.rights,
        });
      return json(404, { error: { message: 'not found' } });
    }),
  );
};

const openUser = async (u: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText('SALE', { selector: 'td' });
  await u.click(screen.getByRole('button', { name: 'Search' }));
  await u.click(await screen.findByText('cashier1'));
  await screen.findByText(/Security Panel - cashier1/i).catch(() => undefined);
};

beforeEach(() => {
  calls = [];
  currentUser = asUser(['security_file.view', 'security_file.edit'], 't1');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Security Panel - rights boxes are never dead', () => {
  it('a saved user’s boxes can be ticked straight away (it switches into Edit), then Save stores them', async () => {
    install(detail());
    const u = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await openUser(u);
    await u.click(await screen.findByRole('tab', { name: /checks approval/i }));
    const box = screen.getByLabelText('Allow module SALE') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    await u.click(box);
    expect(box.checked).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.path === '/admin/users/u1')).toBe(true),
    );
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/admin/users/u1')!;
    expect(patch.body?.rights).toEqual({ modules: ['SALE'], items: {} });
  });

  it('ticking a right inside an unticked module also allows the module', async () => {
    install(detail());
    const u = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await openUser(u);
    await u.click(await screen.findByRole('tab', { name: /inputs/i }));
    await u.click(screen.getByLabelText('POS Add Rights'));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body?.rights).toEqual({
      modules: ['SALE'],
      items: { POS: ['access', 'add'] },
    });
  });

  it('the business owner’s rights are shown but cannot be changed, with the reason', async () => {
    install(
      detail({
        systemRole: 'CLIENT_MASTER_ADMIN',
        rightsEditable: false,
        rights: { modules: ['SALE'], items: { POS: ['access'] } },
      }),
    );
    const u = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await openUser(u);
    await u.click(await screen.findByRole('tab', { name: /checks approval/i }));
    const box = screen.getByLabelText('Allow module SALE') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/always has every right/i)).toBeTruthy();
  });

  it('the Login ID can be changed in Edit when the Login ID rules allow it', async () => {
    install(detail(), true);
    const u = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await openUser(u);
    await u.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('User ID') as HTMLInputElement;
    await waitFor(() => expect(field.disabled).toBe(false));
    await u.clear(field);
    await u.type(field, 'renamed');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.path === '/users/u1/login-id')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/users/u1/login-id')!.body).toEqual({
      newLoginId: 'renamed',
    });
  });

  it('the Login ID stays locked when the rules do not allow a change', async () => {
    install(detail(), false);
    const u = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await openUser(u);
    await u.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('User ID') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Master Admin - Security Panel for a client', () => {
  it('talks to the Master Admin endpoints for that client and is governed by users.manage', async () => {
    currentUser = asUser(['users.view', 'users.manage'], null);
    install(detail());
    const u = userEvent.setup();
    render(
      <SecurityFilePage
        tenantId="tenant-9"
        clientName="MTJ Garments (MTJ)"
        onExit={() => undefined}
      />,
    );
    await screen.findByText(/MTJ Garments \(MTJ\)/);
    await openUser(u);
    await u.click(await screen.findByRole('tab', { name: /checks approval/i }));
    await u.click(screen.getByLabelText('Allow module SALE'));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && c.path === '/master/tenants/tenant-9/user-admin/users/u1',
        ),
      ).toBe(true),
    );
    expect(calls.some((c) => c.path.startsWith('/admin/'))).toBe(false);
    expect(calls.some((c) => c.path === '/master/user-admin/registry')).toBe(true);
  });

  it('cannot Add without users.manage', async () => {
    currentUser = asUser(['users.view'], null);
    install(detail());
    render(<SecurityFilePage tenantId="tenant-9" onExit={() => undefined} />);
    await screen.findByText('SALE', { selector: 'td' });
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
