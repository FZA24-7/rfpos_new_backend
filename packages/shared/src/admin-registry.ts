/**
 * Administrator / Security File registry: the REAL modules, forms and reports of this software and what each right on
 * them means in terms of the central permission catalog (permissions.ts). It is the single source of truth for
 *   Level 1  which modules a user may use (Checks Approval),
 *   Level 2  which forms / reports inside an approved module,
 *   Level 3  which of Access / Add / Edit / Delete.
 * The API turns a user's saved rights into permission keys with `derivePermissions`, and the existing
 * `requirePermission(...)` checks enforce them. Nothing here is a placeholder: an item exists only if the software
 * has that screen/report, and a right exists only if some API route enforces it.
 */

export const RIGHTS = ['access', 'add', 'edit', 'delete'] as const;
export type Right = (typeof RIGHTS)[number];

export interface AdminItem {
  key: string;
  name: string;
  kind: 'form' | 'report';
  /** Permission keys each supported right grants. A right that is not listed does not exist for this item. */
  rights: Partial<Record<Right, readonly string[]>>;
  /** Other items this screen reads from. Informational only (shown as a warning): never granted implicitly. */
  uses?: readonly string[];
}

export interface AdminModule {
  key: string;
  prefix: string;
  name: string;
  items: readonly AdminItem[];
}

const form = (
  key: string,
  name: string,
  rights: AdminItem['rights'],
  uses?: readonly string[],
): AdminItem => ({ key, name, kind: 'form', rights, ...(uses ? { uses } : {}) });

const report = (key: string, name: string, permission: string): AdminItem => ({
  key,
  name,
  kind: 'report',
  rights: { access: [permission] },
});

const adminForm = (
  key: string,
  name: string,
  resource: string,
  supported: readonly Right[],
): AdminItem => {
  const map = { access: 'view', add: 'create', edit: 'edit', delete: 'delete' } as const;
  const rights: Partial<Record<Right, readonly string[]>> = {};
  for (const r of supported) rights[r] = [`${resource}.${map[r]}`];
  return form(key, name, rights);
};

export const ADMIN_REGISTRY: readonly AdminModule[] = [
  {
    key: 'ADMIN',
    prefix: 'ADMIN',
    name: 'ADMINISTRATION',
    items: [
      adminForm('SECURITY_FILE', 'SECURITY FILE', 'security_file', RIGHTS),
      adminForm('UPDATE_USER_LOCATION', 'UPDATE USER LOCATION', 'user_location', [
        'access',
        'edit',
      ]),
      adminForm('ATTRIBUTE_LOCKING', 'ATTRIBUTE LOCKING', 'attribute_locking', ['access', 'edit']),
      adminForm('CLOSE_PERIOD', 'CLOSE PERIOD FOR TRANSACTION', 'period_close', [
        'access',
        'add',
        'delete',
      ]),
      adminForm('LOG_FILE', 'LOG FILE', 'log_file', ['access']),
      adminForm('GENERATE_OVERHEAD', 'GENERATE OVERHEAD', 'overhead', ['access', 'add', 'delete']),
      adminForm('LOCATIONS_STATUS', 'LOCATIONS STATUS', 'location_status', ['access', 'edit']),
      adminForm('SMS_LOG', 'SMS LOG', 'sms_log', ['access']),
      adminForm('BANK_LOG', 'BANK LOG', 'bank_log', ['access']),
      adminForm('USER_CATEGORY', 'USER CATEGORY', 'user_category', RIGHTS),
    ],
  },
  {
    key: 'MASTER',
    prefix: 'MASTER',
    name: 'MASTER FILES',
    items: [
      form('CATEGORIES', 'CATEGORIES', {
        access: ['categories.view'],
        add: ['categories.create'],
        edit: ['categories.edit'],
      }),
      form(
        'SUB_DEPARTMENTS',
        'SUB DEPARTMENTS',
        {
          access: ['sub_departments.view'],
          add: ['sub_departments.create'],
          edit: ['sub_departments.edit'],
        },
        ['CATEGORIES'],
      ),
      form('BRANDS', 'BRANDS', {
        access: ['brands.view'],
        add: ['brands.create'],
        edit: ['brands.edit'],
      }),
      form(
        'PRODUCTS',
        'PRODUCTS',
        {
          access: ['products.view'],
          add: ['products.create'],
          edit: ['products.edit'],
        },
        ['CATEGORIES', 'SUB_DEPARTMENTS', 'BRANDS'],
      ),
      form('BARCODE_LOOKUP', 'BARCODE LOOKUP', { access: ['barcode.view'] }),
    ],
  },
  {
    key: 'INVENTORY',
    prefix: 'INVENTORY',
    name: 'INVENTORY',
    items: [
      form(
        'INVENTORY',
        'STOCK & ADJUSTMENTS',
        {
          access: ['inventory.view'],
          add: ['inventory.create'],
          edit: ['stock.adjust'],
        },
        ['PRODUCTS'],
      ),
      report('STOCK_VALUATION', 'STOCK VALUATION', 'reports.stock_valuation'),
    ],
  },
  {
    key: 'PURCHASE',
    prefix: 'PURCHASE',
    name: 'PURCHASE',
    items: [
      form('SUPPLIERS', 'SUPPLIERS', { access: ['suppliers.view'], add: ['suppliers.create'] }),
      form(
        'PURCHASES',
        'PURCHASE INVOICES',
        {
          access: ['purchases.view', 'purchases.print'],
          add: ['purchases.create'],
          edit: ['purchases.edit'],
        },
        ['SUPPLIERS', 'PRODUCTS', 'CATEGORIES', 'SUB_DEPARTMENTS', 'BRANDS'],
      ),
      report('PAYABLES', 'SUPPLIER BALANCES (PAYABLES)', 'reports.payables'),
    ],
  },
  {
    key: 'SALE',
    prefix: 'SALE',
    name: 'SALE',
    items: [
      form('POS', 'POINT OF SALE', { access: ['pos.view'], add: ['pos.create'] }, [
        'PRODUCTS',
        'BARCODE_LOOKUP',
        'CUSTOMERS',
      ]),
      form('SALES', 'SALES & REFUNDS', {
        access: ['sales.view', 'sales.print', 'sale_returns.view', 'sale_returns.print'],
        add: ['sale.refund'],
      }),
      form('CASH_ACTIVITY', 'DAILY CASH ACTIVITY', {
        access: ['cash_activity.view'],
        add: ['cash_activity.create'],
        edit: ['cash_activity.edit'],
        delete: ['cash_activity.delete'],
      }),
      report('DAILY_CLOSING', 'DAILY SALES REPORT', 'sale_reports.daily_closing'),
      form('CARD_UPDATE', 'CASH AND CREDIT CARD UPDATE', {
        access: ['card_update.view'],
        edit: ['card_update.edit'],
      }),
      form('FBR_REPOST', 'FBR REPOST PERIOD', {
        access: ['fbr_repost.view'],
        edit: ['fbr_repost.edit'],
      }),
      report('BILL_WISE', 'BILL WISE SALES', 'sale_reports.bill_wise'),
      report('SALES_PERSON_WISE', 'SALES PERSON WISE SALES REPORT', 'sale_reports.sales_person'),
      form('PC_SERIAL', 'USER PC SERIAL', {
        access: ['pc_serial.view'],
        edit: ['pc_serial.edit'],
      }),
      report('SALES_SUMMARY', 'SALES SUMMARY', 'reports.sales_summary'),
      report('DAILY_SALES', 'DAILY SALES', 'reports.daily'),
      report('HOURLY_SALES', 'SALES BY HOUR', 'reports.hourly'),
      report('TOP_PRODUCTS', 'TOP PRODUCTS', 'reports.top_products'),
      report('SALES_BY_CASHIER', 'SALES BY CASHIER', 'reports.by_cashier'),
      report('SALES_BY_CATEGORY', 'SALES BY CATEGORY', 'reports.by_category'),
    ],
  },
  {
    key: 'CUSTOMER',
    prefix: 'AR',
    name: 'ACCOUNT RECEIVABLE',
    items: [
      form('CUSTOMERS', 'CUSTOMERS', {
        access: ['customers.view'],
        add: ['customers.create'],
        edit: ['customers.edit'],
      }),
      report('RECEIVABLES', 'CUSTOMER BALANCES (RECEIVABLES)', 'reports.receivables'),
    ],
  },
  {
    key: 'EXPENSE',
    prefix: 'EXPENSE',
    name: 'EXPENSES',
    items: [
      form('EXPENSES', 'EXPENSES', {
        access: ['expenses.view'],
        add: ['expenses.create'],
        edit: ['expenses.edit'],
        delete: ['expenses.delete'],
      }),
      report('PROFIT_LOSS', 'PROFIT & LOSS', 'reports.profit_loss'),
    ],
  },
  {
    key: 'HR',
    prefix: 'HR',
    name: 'EMPLOYEES',
    items: [
      form('EMPLOYEES', 'EMPLOYEES', {
        access: ['employees.view'],
        add: ['employees.create'],
        edit: ['employees.edit'],
      }),
    ],
  },
  {
    key: 'ANALYTICS',
    prefix: 'ANALYTICS',
    name: 'ANALYTICS',
    items: [form('ANALYTICS_OVERVIEW', 'ANALYTICS OVERVIEW', { access: ['analytics.view'] })],
  },
];

/** Permissions every user managed through the Security File receives: the branch lookup the app shell needs. */
export const BASELINE_PERMISSIONS: readonly string[] = ['stores.view'];

/**
 * What a NEW Client Master Admin starts with: only the baseline. The Master Admin assigns every module, form and report
 * right afterwards (Master Admin > client > Security File) - complete access is never granted automatically.
 */
export const CLIENT_ADMIN_START_PERMISSIONS: readonly string[] = BASELINE_PERMISSIONS;

export const findAdminModule = (key: string): AdminModule | undefined =>
  ADMIN_REGISTRY.find((m) => m.key === key);

export const findAdminItem = (
  itemKey: string,
): { module: AdminModule; item: AdminItem } | undefined => {
  for (const module of ADMIN_REGISTRY) {
    const item = module.items.find((i) => i.key === itemKey);
    if (item) return { module, item };
  }
  return undefined;
};

export const supportedRights = (item: AdminItem): Right[] =>
  RIGHTS.filter((r) => item.rights[r] !== undefined);

/** What the administrator saved for one user. */
export interface RightsSelection {
  /** Level 1: approved module keys (Checks Approval). */
  modules: readonly string[];
  /** Level 2 + 3: per item, the rights that are ticked. An item with no ticked right is not accessible. */
  items: Readonly<Record<string, readonly Right[]>>;
}

export class RightsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RightsValidationError';
  }
}

/**
 * Rejects anything that does not exist in the registry (unknown module/item/right), a right the item does not
 * support, or items of a module that is not approved. Also normalises: "add/edit/delete" without "access" is refused
 * because every action needs the screen itself.
 */
export const validateRightsSelection = (sel: RightsSelection): void => {
  const approved = new Set<string>();
  for (const m of sel.modules) {
    if (!findAdminModule(m)) throw new RightsValidationError(`Unknown module "${m}".`);
    approved.add(m);
  }
  for (const [itemKey, rights] of Object.entries(sel.items)) {
    const found = findAdminItem(itemKey);
    if (!found) throw new RightsValidationError(`Unknown form or report "${itemKey}".`);
    if (rights.length === 0) continue;
    if (!approved.has(found.module.key)) {
      throw new RightsValidationError(
        `"${found.item.name}" belongs to module ${found.module.key}, which is not approved for this user.`,
      );
    }
    for (const r of rights) {
      if (!RIGHTS.includes(r) || found.item.rights[r] === undefined) {
        throw new RightsValidationError(`"${found.item.name}" has no "${r}" right.`);
      }
    }
    if (!rights.includes('access')) {
      throw new RightsValidationError(`"${found.item.name}": Add/Edit/Delete need Access as well.`);
    }
  }
};

/** The permission keys a selection grants (baseline included). Only approved modules contribute. */
export const derivePermissions = (sel: RightsSelection): string[] => {
  validateRightsSelection(sel);
  const out = new Set<string>(BASELINE_PERMISSIONS);
  for (const [itemKey, rights] of Object.entries(sel.items)) {
    const found = findAdminItem(itemKey);
    if (!found) continue;
    for (const r of rights) for (const p of found.item.rights[r] ?? []) out.add(p);
  }
  return [...out].sort();
};

/**
 * Display helper for users whose rights come from a shared role (Manager, Cashier ...) and were never saved through the
 * Security File: a right shows as ticked only when ALL of its permission keys are held.
 */
export const selectionFromPermissions = (held: Iterable<string>): RightsSelection => {
  const set = new Set(held);
  const modules: string[] = [];
  const items: Record<string, Right[]> = {};
  for (const m of ADMIN_REGISTRY) {
    for (const item of m.items) {
      const rights = RIGHTS.filter((r) => {
        const keys = item.rights[r];
        return keys !== undefined && keys.every((k) => set.has(k));
      });
      if (rights.includes('access')) {
        items[item.key] = rights;
        if (!modules.includes(m.key)) modules.push(m.key);
      }
    }
  }
  return { modules, items };
};

/**
 * Attributes the Attribute Locking screen can lock. A locked attribute cannot be changed on an existing record until an
 * administrator unlocks it; the API rejects the change (see admin-guards.ts).
 */
export const LOCKABLE_ATTRIBUTES = [
  { key: 'product.name', entity: 'Product', label: 'Product name' },
  { key: 'product.category', entity: 'Product', label: 'Category' },
  { key: 'product.sub_department', entity: 'Product', label: 'Sub-department' },
  { key: 'product.brand', entity: 'Product', label: 'Brand' },
  { key: 'product.supplier', entity: 'Product', label: 'Supplier' },
  { key: 'product.cost_price', entity: 'Product', label: 'Cost price' },
  { key: 'product.selling_price', entity: 'Product', label: 'Selling price' },
  { key: 'product.wholesale_price', entity: 'Product', label: 'Wholesale price' },
  { key: 'product.tax_rate', entity: 'Product', label: 'Tax rate' },
  { key: 'product.unit', entity: 'Product', label: 'Unit' },
  { key: 'product.stock_limits', entity: 'Product', label: 'Minimum / maximum stock' },
] as const;
export type LockableAttributeKey = (typeof LOCKABLE_ATTRIBUTES)[number]['key'];
export const isLockableAttribute = (key: string): boolean =>
  LOCKABLE_ATTRIBUTES.some((a) => a.key === key);
