import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './state/auth.js';
import { Shell, type NavItem } from './components/Shell.js';
import { LoginPage } from './LOGIN/index.js';
import { Spinner } from './components/ui/Spinner.js';
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
  { key: 'pos', label: 'POS', any: ['pos.view'] },
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

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const isTenantUser = !!user?.tenantId;
  const tenantNav: NavItem[] = isTenantUser
    ? [
        ...TENANT_NAV.filter((n) => canAny(user, n.any)).map(({ key, label }) => ({ key, label })),
        ...(canAny(user, ADMIN_VIEW_PERMISSIONS)
          ? [{ key: 'administrator', label: 'Administrator' }]
          : []),
      ]
    : [];
  const [view, setView] = useState<View>(
    isTenantUser ? ({ name: tenantNav[0]?.key ?? 'none' } as View) : { name: 'dashboard' },
  );
  const [storeId, setStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTenantUser) return;
    void (async () => {
      try {
        const stores = await apiRequest<{ id: string }[]>('/stores');
        setStoreId(stores[0]?.id ?? null);
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
        <PosPage storeId={storeId} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading branch…</p>
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
    default:
      content = (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your account has not been granted access to any module yet. Ask an administrator.
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
  if (status === 'restoring') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  return status === 'authenticated' ? <AuthenticatedApp /> : <LoginPage />;
};

const App = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
