import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './state/auth.js';
import { Shell, type NavItem } from './components/Shell.js';
import { LoginPage } from './LOGIN/index.js';
import { Spinner } from './components/ui/Spinner.js';
import { SplashScreen } from './components/SplashScreen.js';
import { DesktopLauncher } from './desktop/DesktopLauncher.js';
import { isDesktopShell, isLauncherRoute } from './desktop/launcher.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TenantDetailPage } from './pages/TenantDetailPage.js';
import { CategoriesPage } from './pages/CategoriesPage.js';
import { SubDepartmentsPage } from './pages/SubDepartmentsPage.js';
import { BrandsPage } from './pages/BrandsPage.js';
import { ProductsPage } from './pages/ProductsPage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { BarcodeLookupPage } from './pages/BarcodeLookupPage.js';
import { SuppliersPage } from './pages/SuppliersPage.js';
import { PurchasesPage } from './pages/PurchasesPage.js';
import { PosPage } from './pages/PosPage.js';
import { SalesPage } from './pages/SalesPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { EmployeesPage } from './pages/EmployeesPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { SaleReportScreen } from './sale/SaleReportScreen.js';
import { CashActivityScreen } from './sale/CashActivityScreen.js';
import { CashCardUpdateScreen } from './sale/CashCardUpdateScreen.js';
import { FbrRepostScreen } from './sale/FbrRepostScreen.js';
import { UserPcSerialScreen } from './sale/UserPcSerialScreen.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { apiRequest } from './api/client.js';
import { AdministratorPage, ADMIN_VIEW_PERMISSIONS } from './pages/admin/AdministratorPage.js';
import { can, canAny } from './state/permissions.js';
import { REPORT_PERMISSIONS } from '@mafk/shared';

type View =
  | { name: 'dashboard' }
  | { name: 'tenant'; tenantId: string }
  | { name: 'categories' }
  | { name: 'sub-departments' }
  | { name: 'brands' }
  | { name: 'products' }
  | { name: 'inventory' }
  | { name: 'barcode' }
  | { name: 'suppliers' }
  | { name: 'purchases' }
  | { name: 'pos' }
  | { name: 'sale-cash' }
  | { name: 'sale-daily' }
  | { name: 'sale-card' }
  | { name: 'sale-fbr' }
  | { name: 'sale-bill' }
  | { name: 'sale-person' }
  | { name: 'sale-serial' }
  | { name: 'sales' }
  | { name: 'customers' }
  | { name: 'expenses' }
  | { name: 'employees' }
  | { name: 'reports' }
  | { name: 'analytics' }
  | { name: 'administrator' };

const MASTER_NAV: NavItem[] = [{ key: 'dashboard', label: 'Dashboard' }];

/** Each tenant screen and the permission(s) that let a user open it. Nothing is shown unless granted. */
const TENANT_NAV: (NavItem & { any: string[] })[] = [
  { key: 'categories', label: 'Categories', any: ['categories.view'] },
  { key: 'sub-departments', label: 'Sub-Departments', any: ['sub_departments.view'] },
  { key: 'brands', label: 'Brands', any: ['brands.view'] },
  { key: 'products', label: 'Products', any: ['products.view'] },
  { key: 'inventory', label: 'Inventory', any: ['inventory.view'] },
  { key: 'barcode', label: 'Barcode Lookup', any: ['barcode.view'] },
  { key: 'suppliers', label: 'Suppliers', any: ['suppliers.view'] },
  { key: 'purchases', label: 'Purchases', any: ['purchases.view'] },
  { key: 'sales', label: 'Sales & Refunds', any: ['sales.view', 'sale_returns.view'] },
  { key: 'customers', label: 'Customers', any: ['customers.view'] },
  { key: 'expenses', label: 'Expenses', any: ['expenses.view'] },
  { key: 'employees', label: 'Employees', any: ['employees.view'] },
  {
    key: 'reports',
    label: 'Reports',
    any: ['reports.view', ...REPORT_PERMISSIONS],
  },
  { key: 'analytics', label: 'Analytics', any: ['analytics.view'] },
];

/** The Sale menu: every item with the permission that opens it (nothing shows unless granted). */
const SALE_MENU: { key: string; label: string; any: string[]; separatorAfter?: boolean }[] = [
  {
    key: 'sale-cash',
    label: 'Daily Cash Activity',
    any: ['cash_activity.view'],
    separatorAfter: true,
  },
  { key: 'pos', label: 'Point of Sale', any: ['pos.view'], separatorAfter: true },
  {
    key: 'sale-daily',
    label: 'Daily Sales Report',
    any: ['sale_reports.daily_closing'],
    separatorAfter: true,
  },
  { key: 'sale-card', label: 'Cash and Credit Card Update', any: ['card_update.view'] },
  { key: 'sale-fbr', label: 'FBR Repost Period', any: ['fbr_repost.view'] },
  { key: 'sale-bill', label: 'Bill Wise Sales', any: ['sale_reports.bill_wise'] },
  {
    key: 'sale-person',
    label: 'Sales Person Wise Sales Report',
    any: ['sale_reports.sales_person'],
  },
  { key: 'sale-serial', label: 'User PC Serial', any: ['pc_serial.view'] },
];

export const buildSaleMenu = (user: Parameters<typeof canAny>[0]): NavItem | null => {
  const children: NavItem['children'] = [];
  for (const m of SALE_MENU) {
    if (!canAny(user, m.any)) continue;
    children.push({ key: m.key, label: m.label });
    if (m.separatorAfter) children.push('separator');
  }
  while (children[children.length - 1] === 'separator') children.pop();
  // a separator must not stand first or twice in a row once some items are hidden
  const tidy = children.filter(
    (c, i) => !(c === 'separator' && (i === 0 || children[i - 1] === 'separator')),
  );
  return tidy.length > 0 ? { key: 'sale', label: 'Sale', children: tidy } : null;
};

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const isTenantUser = !!user?.tenantId;
  const saleMenu = isTenantUser ? buildSaleMenu(user) : null;
  const tenantNav: NavItem[] = isTenantUser
    ? [
        ...(saleMenu ? [saleMenu] : []),
        ...TENANT_NAV.filter((n) => canAny(user, n.any)).map(({ key, label }) => ({ key, label })),
        ...(canAny(user, ADMIN_VIEW_PERMISSIONS)
          ? [{ key: 'administrator', label: 'Administrator' }]
          : []),
      ]
    : [];
  const [view, setView] = useState<View>(
    isTenantUser
      ? ({
          name: tenantNav[0]?.children?.find((c) => c !== 'separator')
            ? (tenantNav[0].children.find((c) => c !== 'separator') as NavItem).key
            : (tenantNav[0]?.key ?? 'none'),
        } as View)
      : { name: 'dashboard' },
  );
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');

  useEffect(() => {
    if (!isTenantUser) return;
    void (async () => {
      try {
        const stores = await apiRequest<{ id: string; name?: string }[]>('/stores');
        setStoreId(stores[0]?.id ?? null);
        setStoreName(stores[0]?.name ?? '');
      } catch {
        setStoreId(null);
      }
    })();
  }, [isTenantUser]);

  const nav = isTenantUser ? tenantNav : MASTER_NAV;
  const activeNavKey = view.name === 'tenant' ? 'dashboard' : view.name;

  const navigate = (key: string) => {
    if (key === 'dashboard') setView({ name: 'dashboard' });
    else setView({ name: key } as View);
  };

  /** Closing a Sale window returns to the first screen the user may open (the Sale menu stays in the bar). */
  const closeSale = () => setView({ name: 'sale-home' } as unknown as View);

  let content;
  switch (view.name) {
    case 'dashboard':
      content = (
        <DashboardPage onOpenTenant={(tenantId) => setView({ name: 'tenant', tenantId })} />
      );
      break;
    case 'tenant':
      content = (
        <TenantDetailPage tenantId={view.tenantId} onBack={() => setView({ name: 'dashboard' })} />
      );
      break;
    case 'categories':
      content = <CategoriesPage />;
      break;
    case 'sub-departments':
      content = <SubDepartmentsPage />;
      break;
    case 'brands':
      content = <BrandsPage />;
      break;
    case 'products':
      content = <ProductsPage />;
      break;
    case 'inventory':
      content = storeId ? (
        <InventoryPage storeId={storeId} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading branch…</p>
      );
      break;
    case 'barcode':
      content = <BarcodeLookupPage />;
      break;
    case 'suppliers':
      content = <SuppliersPage />;
      break;
    case 'purchases':
      content = <PurchasesPage />;
      break;
    case 'pos':
      content = storeId ? (
        <PosPage
          storeId={storeId}
          storeName={storeName}
          canChangePrice={canAny(user, ['price.change'])}
          canRefund={canAny(user, ['sale.refund'])}
          canViewBills={canAny(user, ['sales.view'])}
          canIssueVoucher={canAny(user, ['discount.apply'])}
        />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading branch…</p>
      );
      break;
    case 'sale-cash':
      content = (
        <CashActivityScreen
          onClose={closeSale}
          canSave={canAny(user, ['cash_activity.create', 'cash_activity.edit'])}
          canClear={canAny(user, ['cash_activity.delete'])}
        />
      );
      break;
    case 'sale-daily':
      content = <SaleReportScreen kind="daily" onClose={closeSale} />;
      break;
    case 'sale-bill':
      content = (
        <SaleReportScreen
          kind="bill"
          onClose={closeSale}
          canEditRegions={canAny(user, ['settings.edit'])}
        />
      );
      break;
    case 'sale-person':
      content = <SaleReportScreen kind="person" onClose={closeSale} />;
      break;
    case 'sale-card':
      content = <CashCardUpdateScreen onClose={closeSale} />;
      break;
    case 'sale-fbr':
      content = <FbrRepostScreen onClose={closeSale} canEdit={canAny(user, ['fbr_repost.edit'])} />;
      break;
    case 'sale-serial':
      content = (
        <UserPcSerialScreen onClose={closeSale} canEdit={canAny(user, ['pc_serial.edit'])} />
      );
      break;
    case 'sales':
      content = <SalesPage />;
      break;
    case 'customers':
      content = <CustomersPage />;
      break;
    case 'expenses':
      content = <ExpensesPage />;
      break;
    case 'employees':
      content = <EmployeesPage />;
      break;
    case 'reports':
      content = <ReportsPage hasPermission={(k) => can(user, k)} />;
      break;
    case 'analytics':
      content = <AnalyticsPage />;
      break;
    case 'administrator':
      content = <AdministratorPage />;
      break;
    case 'sale-home' as View['name']:
      content = (
        <div className="mx-auto max-w-xl rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Choose an option from the <strong>Sale</strong> menu above.
        </div>
      );
      break;
    default:
      content = (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No rights have been assigned to your account yet. Please ask the Master Admin to assign
          them.
        </p>
      );
  }

  return (
    <Shell nav={nav} activeNavKey={activeNavKey} onNavigate={navigate}>
      {content}
    </Shell>
  );
};

const AppContent = () => {
  const { status } = useAuth();
  // Desktop shell: tell the window manager the app (or the sign-in page) is on screen so it can fade it in.
  useEffect(() => {
    if (status !== 'restoring') window.mafkDesktop?.appReady?.();
  }, [status]);
  if (status === 'restoring') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  return status === 'authenticated' ? <AuthenticatedApp /> : <LoginPage />;
};

// The opening animation plays once each time the software is launched (not after signing out). In the desktop shell the
// round sign-in badge is the opening screen, so the splash is not repeated inside the app window.
let splashPlayed = isDesktopShell();

const MainApp = () => {
  const [splash, setSplash] = useState(!splashPlayed);
  return (
    <AuthProvider>
      <div className={isDesktopShell() ? 'app-reveal' : undefined}>
        <AppContent />
      </div>
      {splash ? (
        <SplashScreen
          onDone={() => {
            splashPlayed = true;
            setSplash(false);
          }}
        />
      ) : null}
    </AuthProvider>
  );
};

const App = () => (isLauncherRoute() ? <DesktopLauncher /> : <MainApp />);

export default App;
