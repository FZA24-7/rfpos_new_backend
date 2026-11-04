import { useState } from 'react';
import type { ComponentType } from 'react';
import {
  Banknote,
  ClipboardList,
  FileClock,
  Lock,
  MapPin,
  MessageSquare,
  Percent,
  ShieldCheck,
  Tags,
  CalendarX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../../state/auth.js';
import { can } from '../../state/permissions.js';
import { SecurityFilePage } from './SecurityFilePage.js';
import {
  AttributeLockingPage,
  BankLogPage,
  ClosePeriodPage,
  GenerateOverheadPage,
  LocationsStatusPage,
  LogFilePage,
  SmsLogPage,
  UpdateUserLocationPage,
  UserCategoryPage,
} from './AdminScreens.js';

interface Module {
  key: string;
  label: string;
  permission: string;
  icon: LucideIcon;
  Screen: ComponentType<{ onExit: () => void }>;
}

/** The ten Administrator modules. A tile appears only when the user holds that module's view permission. */
export const ADMIN_MODULES: Module[] = [
  {
    key: 'security_file',
    label: 'Security File',
    permission: 'security_file.view',
    icon: ShieldCheck,
    Screen: SecurityFilePage,
  },
  {
    key: 'user_location',
    label: 'Update User Location',
    permission: 'user_location.view',
    icon: MapPin,
    Screen: UpdateUserLocationPage,
  },
  {
    key: 'attribute_locking',
    label: 'Attribute Locking',
    permission: 'attribute_locking.view',
    icon: Lock,
    Screen: AttributeLockingPage,
  },
  {
    key: 'period_close',
    label: 'Close Period for Transaction',
    permission: 'period_close.view',
    icon: CalendarX,
    Screen: ClosePeriodPage,
  },
  {
    key: 'log_file',
    label: 'Log File',
    permission: 'log_file.view',
    icon: FileClock,
    Screen: LogFilePage,
  },
  {
    key: 'overhead',
    label: 'Generate Overhead',
    permission: 'overhead.view',
    icon: Percent,
    Screen: GenerateOverheadPage,
  },
  {
    key: 'location_status',
    label: 'Locations Status',
    permission: 'location_status.view',
    icon: ClipboardList,
    Screen: LocationsStatusPage,
  },
  {
    key: 'sms_log',
    label: 'SMS Log',
    permission: 'sms_log.view',
    icon: MessageSquare,
    Screen: SmsLogPage,
  },
  {
    key: 'bank_log',
    label: 'Bank Log',
    permission: 'bank_log.view',
    icon: Banknote,
    Screen: BankLogPage,
  },
  {
    key: 'user_category',
    label: 'User Category',
    permission: 'user_category.view',
    icon: Tags,
    Screen: UserCategoryPage,
  },
];

export const ADMIN_VIEW_PERMISSIONS = ADMIN_MODULES.map((m) => m.permission);

export const AdministratorPage = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const allowed = ADMIN_MODULES.filter((m) => can(user, m.permission));
  const active = allowed.find((m) => m.key === open);

  if (active) return <active.Screen onExit={() => setOpen(null)} />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Administrator</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {allowed.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setOpen(m.key)}
            className="focus-ring flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <m.icon size={20} />
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
};
