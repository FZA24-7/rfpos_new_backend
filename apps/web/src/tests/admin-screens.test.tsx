import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthUser } from '../api/types.js';

let currentUser: AuthUser;
vi.mock('../state/auth.js', () => ({
  useAuth: () => ({ user: currentUser }),
}));

const { SecurityFilePage } = await import('../pages/admin/SecurityFilePage.js');
const { AdministratorPage } = await import('../pages/admin/AdministratorPage.js');

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
      key: 'ADMIN',
      prefix: 'ADMIN',
      name: 'ADMINISTRATION',
      items: [
        {
          key: 'SECURITY_FILE',
          name: 'SECURITY FILE',
          kind: 'form',
          rights: ['access', 'add', 'edit', 'delete'],
          uses: [],
        },
      ],
    },
    {
      key: 'SALE',
      prefix: 'SALE',
      name: 'SALE',
      items: [
        { key: 'POS', name: 'POS', kind: 'form', rights: ['access', 'add'], uses: [] },
        { key: 'DAILY', name: 'DAILY SALES', kind: 'report', rights: ['access'], uses: [] },
      ],
    },
  ],
};
const lookups = {
  categories: [],
  locations: [{ id: 'st1', code: 'MAIN', name: 'Main branch' }],
};
const created = {
  id: 'u1',
  loginId: 'cashier1',
  displayName: 'Ali Cashier',
  status: 'ACTIVE',
  systemRole: 'CUSTOM',
  storeId: 'st1',
  storeName: 'Main branch',
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
  rights: { modules: ['SALE'], items: { POS: ['access', 'add'] } },
  rightsSource: 'saved',
  rightsEditable: true,
  effectivePermissions: [],
};

const asUser = (permissions: string[]): AuthUser =>
  ({
    id: 'me',
    loginId: 'owner',
    displayName: 'Owner',
    tenantId: 't1',
    systemRole: 'CLIENT_MASTER_ADMIN',
    permissions,
  }) as unknown as AuthUser;

beforeEach(() => {
  calls = [];
  currentUser = asUser(['security_file.view', 'security_file.create', 'security_file.edit']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const path = url.pathname.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      if (path === '/admin/registry') return json(200, registry);
      if (path === '/admin/security/lookups') return json(200, lookups);
      if (path === '/admin/users' && method === 'POST') return json(201, created);
      if (path === '/admin/users') return json(200, [created]);
      return json(404, { error: { message: 'not found' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Security Panel', () => {
  it('lists every module and shows only that module’s real forms and reports', async () => {
    const user = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await screen.findByText('ADMINISTRATION');
    // ADMIN has a form and no reports
    await user.click(screen.getByRole('tab', { name: /reports/i }));
    expect(screen.getByText('This module has no reports.')).toBeTruthy();
    // SALE lists its own report under Reports and its own form under Inputs
    await user.click(screen.getByText('SALE', { selector: 'td' }));
    expect(screen.getByText('DAILY SALES')).toBeTruthy();
    expect(screen.queryByText('POS')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /inputs/i }));
    expect(screen.getByText('POS')).toBeTruthy();
    expect(screen.queryByText('DAILY SALES')).toBeNull();
  });

  it('Add creates a user with exactly the rights that were ticked', async () => {
    const user = userEvent.setup();
    render(<SecurityFilePage onExit={() => undefined} />);
    await screen.findByText('ADMINISTRATION');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('User ID'), 'cashier1');
    await user.type(screen.getByLabelText('User Name'), 'Ali Cashier');
    await user.type(screen.getByLabelText('Password'), 'Str0ng-Pass!');
    await user.click(screen.getByRole('tab', { name: /checks approval/i }));
    await user.click(screen.getByLabelText('Allow module SALE'));
    await user.click(screen.getByRole('tab', { name: /user details/i }));
    await user.click(screen.getByText('SALE', { selector: 'td' }));
    await user.click(screen.getByRole('tab', { name: /inputs/i }));
    await user.click(screen.getByLabelText('POS Add Rights'));
    expect((screen.getByLabelText('POS Access') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/admin/users')!;
    expect(post.body).toMatchObject({
      loginId: 'cashier1',
      displayName: 'Ali Cashier',
      rights: { modules: ['SALE'], items: { POS: ['access', 'add'] } },
    });
    await screen.findByText(/cashier1 created/i);
  });

  it('cannot Add without the create permission', async () => {
    currentUser = asUser(['security_file.view']);
    render(<SecurityFilePage onExit={() => undefined} />);
    await screen.findByText('ADMINISTRATION');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Exit closes the panel', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<SecurityFilePage onExit={onExit} />);
    await screen.findByText('ADMINISTRATION');
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).toHaveBeenCalled();
  });
});

describe('Administrator menu', () => {
  it('shows only the modules the user may view', () => {
    currentUser = asUser(['log_file.view', 'sms_log.view']);
    render(<AdministratorPage />);
    const tiles = screen.getAllByRole('button').map((b) => b.textContent);
    expect(tiles).toEqual(['Log File', 'SMS Log']);
  });

  it('shows nothing when no admin permission is held', () => {
    currentUser = asUser(['pos.view']);
    render(<AdministratorPage />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('opens a module and Exit returns to the menu', async () => {
    currentUser = asUser(['user_category.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [])),
    );
    const user = userEvent.setup();
    render(<AdministratorPage />);
    await user.click(screen.getByRole('button', { name: 'User Category' }));
    await screen.findByText('No user categories');
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(within(document.body).getByRole('button', { name: 'User Category' })).toBeTruthy();
  });
});
