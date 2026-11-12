import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FilePlus,
  FileSearch,
  LogOut,
  Pencil,
  Printer,
  Save,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ApiError } from '../../api/client.js';
import {
  RIGHT_LABELS,
  userApiFor,
  type UserApi,
  type Lookups,
  type Registry,
  type RegistryItem,
  type RegistryModule,
  type Right,
  type RightsSelection,
  type SaveUserBody,
  type UserDetail,
  type UserRow,
} from '../../api/admin.js';
import { useAuth } from '../../state/auth.js';
import { can } from '../../state/permissions.js';
import { ErrorBanner } from '../../components/ui/ErrorBanner.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Badge } from '../../components/ui/Badge.js';
import {
  cloneSelection,
  emptySelection,
  grantedCount,
  isModuleApproved,
  itemsByKind,
  missingDependencies,
  rightsOf,
  sameSelection,
  setModuleApproved,
  toggleRight,
} from './rightsModel.js';

type Mode = 'idle' | 'view' | 'add' | 'edit';

interface FormState {
  loginId: string;
  displayName: string;
  password: string;
  fbrPosId: string;
  macAddress: string;
  userCategoryId: string;
  counterPos: string;
  port: string;
  fbrToken: string;
  clearToken: boolean;
  pcSerial: string;
  storeId: string;
}

const blankForm = (): FormState => ({
  loginId: '',
  displayName: '',
  password: '',
  fbrPosId: '',
  macAddress: '',
  userCategoryId: '',
  counterPos: '',
  port: '',
  fbrToken: '',
  clearToken: false,
  pcSerial: '',
  storeId: '',
});

const formFrom = (u: UserDetail): FormState => ({
  loginId: u.loginId,
  displayName: u.displayName,
  password: '',
  fbrPosId: u.profile.fbrPosId ?? '',
  macAddress: u.profile.macAddress ?? '',
  userCategoryId: u.profile.userCategoryId ?? '',
  counterPos: u.profile.counterPos ?? '',
  port: u.profile.port?.toString() ?? '',
  fbrToken: '',
  clearToken: false,
  pcSerial: u.profile.pcSerial ?? '',
  storeId: u.storeId ?? '',
});

const message = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

/** A stable id for this browser/PC. A web page cannot read hardware serial numbers, so this is what "Get Serial" fills in. */
const newSerial = (): string =>
  `PC-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
const deviceSerial = (): string => {
  try {
    let v = localStorage.getItem('mafk.deviceSerial');
    if (!v) {
      v = newSerial();
      localStorage.setItem('mafk.deviceSerial', v);
    }
    return v;
  } catch {
    return newSerial();
  }
};

const fieldCls =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-800/50';

const ToolbarButton = ({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="focus-ring flex h-16 w-20 flex-col items-center justify-center gap-1 rounded border border-slate-300 bg-slate-50 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
  >
    {icon}
    {label}
  </button>
);

const Field = ({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) => (
  <label className={`flex items-center gap-3 ${wide ? 'col-span-2' : ''}`}>
    <span className="w-28 shrink-0 text-sm text-slate-700 dark:text-slate-300">{label}</span>
    {children}
  </label>
);

const Modal = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={title}
    className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
  >
    <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>
      {children}
    </div>
  </div>
);

/**
 * The Security Panel. With `tenantId` it is the platform Master Admin's panel for that business: the same screen,
 * pointed at the Master Admin endpoints, governed by the Master Admin's own `users.*` rights.
 */
export const SecurityFilePage = ({
  onExit,
  tenantId,
  clientName,
}: {
  onExit: () => void;
  tenantId?: string;
  clientName?: string;
}) => {
  const { user: me } = useAuth();
  const api = useMemo(() => userApiFor(tenantId), [tenantId]);
  const mayAdd = tenantId ? can(me, 'users.manage') : can(me, 'security_file.create');
  const mayEdit = tenantId ? can(me, 'users.manage') : can(me, 'security_file.edit');
  const mayDelete = tenantId ? can(me, 'users.manage') : can(me, 'security_file.delete');
  const [loginIdCan, setLoginIdCan] = useState(false);

  const [registry, setRegistry] = useState<Registry | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [loaded, setLoaded] = useState<UserDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [rights, setRights] = useState<RightsSelection>(emptySelection);
  const [baseRights, setBaseRights] = useState<RightsSelection>(emptySelection);
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<'details' | 'approval'>('details');
  const [gridTab, setGridTab] = useState<'inputs' | 'reports'>('inputs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [r, l] = await Promise.all([api.registry(), api.lookups()]);
        if (cancelled) return;
        setRegistry(r);
        setLookups(l);
        setModuleKey(r.modules[0]?.key ?? null);
      } catch (err) {
        if (!cancelled) setLoadError(message(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const editing = mode === 'add' || mode === 'edit';
  const rightsLocked = loaded !== null && !loaded.rightsEditable;
  const module: RegistryModule | undefined = registry?.modules.find((m) => m.key === moduleKey);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const loadUser = useCallback(
    async (id: string) => {
      setError(null);
      setNotice(null);
      try {
        const u = await api.user(id);
        setLoaded(u);
        setForm(formFrom(u));
        setRights(cloneSelection(u.rights));
        setBaseRights(cloneSelection(u.rights));
        setMode('view');
        // Whether this person may change this user's Login ID is decided by the server's Login ID rules.
        setLoginIdCan(false);
        api
          .loginIdEditable(id)
          .then(setLoginIdCan)
          .catch(() => setLoginIdCan(false));
      } catch (err) {
        setError(message(err));
      }
    },
    [api],
  );

  const startAdd = () => {
    setError(null);
    setNotice(null);
    setLoaded(null);
    setForm({ ...blankForm(), storeId: lookups?.locations[0]?.id ?? '' });
    setRights(emptySelection());
    setBaseRights(emptySelection());
    setMode('add');
    setTopTab('details');
  };

  const undo = () => {
    setError(null);
    if (mode === 'add') {
      setForm(blankForm());
      setRights(emptySelection());
      setLoaded(null);
      setMode('idle');
    } else if (loaded) {
      setForm(formFrom(loaded));
      setRights(cloneSelection(baseRights));
      setMode('view');
    }
  };

  const body = (): SaveUserBody => {
    const portNum = form.port.trim() === '' ? null : Number(form.port);
    return {
      displayName: form.displayName.trim(),
      fbrPosId: form.fbrPosId.trim() || null,
      macAddress: form.macAddress.trim() || null,
      userCategoryId: form.userCategoryId || null,
      counterPos: form.counterPos.trim() || null,
      port: portNum,
      pcSerial: form.pcSerial.trim() || null,
      storeId: form.storeId || null,
    };
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    if (form.displayName.trim().length < 2)
      return setError('Enter the user name (at least 2 characters).');
    if (form.port.trim() !== '' && !/^\d{1,5}$/.test(form.port.trim()))
      return setError('Port must be a number.');
    setBusy(true);
    try {
      let saved: UserDetail;
      if (mode === 'add') {
        if (!form.loginId.trim()) return setError('Enter the User ID.');
        if (!form.password) return setError('Enter a password for the new user.');
        saved = await api.createUser({
          ...body(),
          loginId: form.loginId.trim(),
          password: form.password,
          ...(form.fbrToken.trim() ? { fbrToken: form.fbrToken.trim() } : {}),
          rights,
        });
        setNotice(`User ${saved.loginId} created.`);
      } else if (loaded) {
        const patch: Parameters<typeof api.updateUser>[1] = { ...body() };
        if (form.password) patch.password = form.password;
        if (form.clearToken) patch.fbrToken = null;
        else if (form.fbrToken.trim()) patch.fbrToken = form.fbrToken.trim();
        if (loaded.rightsEditable && !sameSelection(rights, baseRights)) patch.rights = rights;
        if (loginIdCan && form.loginId.trim().toLowerCase() !== loaded.loginId) {
          await api.changeLoginId(loaded.id, form.loginId.trim());
        }
        saved = await api.updateUser(loaded.id, patch);
        setNotice('Saved.');
      } else return;
      setLoaded(saved);
      setForm(formFrom(saved));
      setRights(cloneSelection(saved.rights));
      setBaseRights(cloneSelection(saved.rights));
      setMode('view');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!loaded) return;
    if (!window.confirm(`Delete user ${loaded.loginId}? They will no longer be able to sign in.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(loaded.id);
      setNotice(`User ${loaded.loginId} deleted.`);
      setLoaded(null);
      setForm(blankForm());
      setRights(emptySelection());
      setMode('idle');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const updateSerial = async () => {
    if (!loaded) return;
    setError(null);
    try {
      const saved = await api.updateUser(loaded.id, {
        pcSerial: form.pcSerial.trim() || null,
      });
      setLoaded(saved);
      setNotice('PC serial updated.');
    } catch (err) {
      setError(message(err));
    }
  };

  const warnings = useMemo(
    () => (registry ? missingDependencies(registry, rights) : []),
    [registry, rights],
  );

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!registry || !lookups) return <Spinner label="Loading Security Panel…" />;

  const gridItems = module ? itemsByKind(module, gridTab === 'inputs' ? 'form' : 'report') : [];
  const approved = module ? isModuleApproved(rights, module.key) : false;
  // Rights can be changed while adding/editing, and also straight from a loaded user: touching a box then switches
  // into Edit automatically (Save/Undo apply as usual), so the boxes are never "dead" after a user has been created.
  const mayChangeRights =
    !rightsLocked && (editing || (mode === 'view' && loaded !== null && mayEdit));
  const gridDisabled = !mayChangeRights;
  const ensureEdit = () => {
    if (mode === 'view') setMode('edit');
  };

  const tick = (item: RegistryItem, right: Right, on: boolean) => {
    if (!module) return;
    ensureEdit();
    // Ticking a right inside a module that is not yet allowed allows the module too (a right needs its module).
    setRights((r) =>
      toggleRight(on ? setModuleApproved(r, module, true) : r, module, item, right, on),
    );
  };

  const rightsHint: string | null = (() => {
    if (mode === 'idle' || (!loaded && mode !== 'add'))
      return 'Click Add to create a user, or Search to open an existing one.';
    if (rightsLocked)
      return loaded?.systemRole === 'CLIENT_MASTER_ADMIN'
        ? 'This is the business owner. The owner always has every right, so this is shown for information only.'
        : 'You cannot change your own rights.';
    if (!mayChangeRights) return 'You do not have permission to change users.';
    if (mode === 'view')
      return loaded?.rightsSource === 'role'
        ? 'These rights come from the user’s role. Tick any box to give this user their own rights, then click Save.'
        : 'Tick any box to change this user’s rights, then click Save.';
    return null;
  })();

  return (
    <div className="text-slate-900 dark:text-slate-100">
      {/* title + toolbar (matches the reference Security Panel) */}
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Security Panel{clientName ? ` — ${clientName}` : ''}
        </h1>
        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Security Panel actions">
          <ToolbarButton
            icon={<FileSearch size={22} />}
            label="Rights Detail"
            disabled={!loaded}
            onClick={() => setDetailOpen(true)}
          />
          <ToolbarButton
            icon={<Search size={22} />}
            label="Search"
            disabled={editing}
            onClick={() => setSearchOpen(true)}
          />
          <ToolbarButton
            icon={<FilePlus size={22} />}
            label="Add"
            disabled={editing || !mayAdd}
            onClick={startAdd}
          />
          <ToolbarButton
            icon={<Pencil size={22} />}
            label="Edit"
            disabled={mode !== 'view' || !mayEdit}
            onClick={() => {
              setNotice(null);
              setMode('edit');
            }}
          />
          <ToolbarButton
            icon={<Save size={22} />}
            label="Save"
            disabled={!editing || busy}
            onClick={() => void save()}
          />
          <ToolbarButton
            icon={<Trash2 size={22} />}
            label="Delete"
            disabled={mode !== 'view' || !mayDelete || busy}
            onClick={() => void remove()}
          />
          <ToolbarButton
            icon={<Undo2 size={22} />}
            label="Undo"
            disabled={!editing}
            onClick={undo}
          />
          <ToolbarButton
            icon={<Printer size={22} />}
            label="Print"
            disabled={!loaded}
            onClick={() => window.print()}
          />
          <ToolbarButton icon={<LogOut size={22} />} label="Exit" onClick={onExit} />
        </div>
      </div>

      {error ? (
        <div className="no-print mb-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="no-print mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
        >
          {notice}
        </p>
      ) : null}

      <div className="no-print grid gap-3 lg:grid-cols-[18rem_1fr]">
        {/* left: modules */}
        <div className="overflow-hidden rounded border border-slate-300 dark:border-slate-600">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left dark:bg-slate-800">
              <tr>
                <th className="px-2 py-1.5">Prefix</th>
                <th className="px-2 py-1.5">Module Name</th>
              </tr>
            </thead>
            <tbody>
              {registry.modules.map((m) => (
                <tr
                  key={m.key}
                  onClick={() => setModuleKey(m.key)}
                  aria-selected={m.key === moduleKey}
                  className={`cursor-pointer border-t border-slate-200 dark:border-slate-700 ${
                    m.key === moduleKey
                      ? 'bg-brand-600 text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <td className="px-2 py-1.5">
                    <button type="button" className="text-left" onClick={() => setModuleKey(m.key)}>
                      {m.prefix}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">{m.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {/* right top: User Details | Checks Approval */}
          <div className="rounded border border-slate-300 dark:border-slate-600">
            <div
              role="tablist"
              className="flex border-b border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800"
            >
              {(['details', 'approval'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={topTab === t}
                  type="button"
                  onClick={() => setTopTab(t)}
                  className={`px-4 py-2 text-sm ${topTab === t ? 'bg-white font-semibold dark:bg-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  {t === 'details' ? 'User Details' : 'Checks Approval'}
                </button>
              ))}
            </div>

            {topTab === 'details' ? (
              <div className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-2">
                <Field label="User ID :">
                  <input
                    aria-label="User ID"
                    className={fieldCls}
                    value={form.loginId}
                    disabled={!(mode === 'add' || (mode === 'edit' && loginIdCan))}
                    onChange={(e) => set('loginId', e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="FBR POS ID :">
                  <input
                    aria-label="FBR POS ID"
                    className={fieldCls}
                    value={form.fbrPosId}
                    disabled={!editing}
                    onChange={(e) => set('fbrPosId', e.target.value)}
                  />
                </Field>
                <Field label="User Name :" wide>
                  <input
                    aria-label="User Name"
                    className={fieldCls}
                    value={form.displayName}
                    disabled={!editing}
                    onChange={(e) => set('displayName', e.target.value)}
                  />
                </Field>
                <Field label="Password :">
                  <input
                    aria-label="Password"
                    type="password"
                    className={fieldCls}
                    value={form.password}
                    disabled={!editing}
                    placeholder={mode === 'edit' ? 'Leave blank to keep' : ''}
                    onChange={(e) => set('password', e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Mac Address :">
                  <input
                    aria-label="Mac Address"
                    className={fieldCls}
                    value={form.macAddress}
                    disabled={!editing}
                    onChange={(e) => set('macAddress', e.target.value)}
                  />
                </Field>
                <Field label="User Type :">
                  <select
                    aria-label="User Type"
                    className={fieldCls}
                    value={form.userCategoryId}
                    disabled={!editing}
                    onChange={(e) => set('userCategoryId', e.target.value)}
                  >
                    <option value="">—</option>
                    {lookups.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Counter POS :">
                    <input
                      aria-label="Counter POS"
                      className={fieldCls}
                      value={form.counterPos}
                      disabled={!editing}
                      onChange={(e) => set('counterPos', e.target.value)}
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      aria-label="Port"
                      inputMode="numeric"
                      className={fieldCls}
                      value={form.port}
                      disabled={!editing}
                      onChange={(e) => set('port', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="User Location :" wide>
                  <select
                    aria-label="User Location"
                    className={fieldCls}
                    value={form.storeId}
                    disabled={!editing}
                    onChange={(e) => set('storeId', e.target.value)}
                  >
                    <option value="">—</option>
                    {lookups.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="FBR Token" wide>
                  <input
                    aria-label="FBR Token"
                    className={fieldCls}
                    value={form.fbrToken}
                    disabled={!editing || form.clearToken}
                    placeholder={
                      loaded?.profile.fbrTokenSet
                        ? `Saved ${loaded.profile.fbrTokenHint ?? ''} - type to replace`
                        : ''
                    }
                    onChange={(e) => set('fbrToken', e.target.value)}
                    autoComplete="off"
                  />
                  {mode === 'edit' && loaded?.profile.fbrTokenSet ? (
                    <label className="flex shrink-0 items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={form.clearToken}
                        onChange={(e) => set('clearToken', e.target.checked)}
                      />{' '}
                      Clear
                    </label>
                  ) : null}
                </Field>
                <div className="col-span-2 flex flex-wrap items-center gap-3">
                  <Field label="User PC Serial #">
                    <input
                      aria-label="User PC Serial"
                      className={fieldCls}
                      value={form.pcSerial}
                      disabled={!editing}
                      onChange={(e) => set('pcSerial', e.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={!editing}
                    onClick={() => set('pcSerial', deviceSerial())}
                    className="focus-ring rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Get Serial
                  </button>
                  <button
                    type="button"
                    disabled={
                      !loaded ||
                      !mayEdit ||
                      mode === 'add' ||
                      form.pcSerial.trim() === (loaded?.profile.pcSerial ?? '')
                    }
                    onClick={() => void updateSerial()}
                    className="focus-ring rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Update Serial
                  </button>
                </div>
                {loaded && !editing ? (
                  <p className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                    Status:{' '}
                    <Badge tone={loaded.status === 'ACTIVE' ? 'green' : 'red'}>
                      {loaded.status}
                    </Badge>{' '}
                    {loaded.systemRole !== 'CUSTOM'
                      ? `· Role: ${loaded.systemRole.replace(/_/g, ' ').toLowerCase()}`
                      : ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="p-4">
                <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
                  Tick the modules this user may use. A module that is not ticked stays completely
                  inaccessible, whatever its forms say.
                </p>
                {rightsHint ? (
                  <p
                    role="status"
                    className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
                  >
                    {rightsHint}
                  </p>
                ) : null}
                <table className="w-full max-w-xl text-sm">
                  <thead className="bg-slate-100 text-left dark:bg-slate-800">
                    <tr>
                      <th className="px-2 py-1.5">Prefix</th>
                      <th className="px-2 py-1.5">Module Name</th>
                      <th className="px-2 py-1.5">Allowed</th>
                      <th className="px-2 py-1.5">Granted items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registry.modules.map((m) => (
                      <tr key={m.key} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-1.5">{m.prefix}</td>
                        <td className="px-2 py-1.5">{m.name}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Allow module ${m.name}`}
                            checked={isModuleApproved(rights, m.key)}
                            disabled={!mayChangeRights}
                            onChange={(e) => {
                              ensureEdit();
                              setRights((r) => setModuleApproved(r, m, e.target.checked));
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {grantedCount(rights, m)} / {m.items.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* right bottom: Inputs | Reports of the selected module */}
          <div className="rounded border border-slate-300 dark:border-slate-600">
            <div
              role="tablist"
              className="flex items-center border-b border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800"
            >
              {(['inputs', 'reports'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={gridTab === t}
                  type="button"
                  onClick={() => setGridTab(t)}
                  className={`px-4 py-2 text-sm ${gridTab === t ? 'bg-white font-semibold dark:bg-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  {t === 'inputs' ? 'Inputs' : 'Reports'}
                </button>
              ))}
              {module ? (
                <span className="ml-auto px-3 text-xs text-slate-500 dark:text-slate-400">
                  {module.prefix} - {module.name}
                </span>
              ) : null}
            </div>
            {rightsLocked ? (
              <p className="border-b border-slate-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-slate-700 dark:bg-amber-900/20 dark:text-amber-200">
                {loaded?.id === me?.id
                  ? 'You cannot change your own rights.'
                  : 'Only the Master Admin can assign rights to this account.'}
              </p>
            ) : null}
            {loaded && loaded.rightsSource === 'role' && !rightsLocked ? (
              <p className="border-b border-slate-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-slate-700 dark:bg-amber-900/20 dark:text-amber-200">
                These rights come from the shared role "
                {loaded.systemRole.replace(/_/g, ' ').toLowerCase()}". Saving here gives this user
                their own rights.
              </p>
            ) : null}
            {mode !== 'idle' && module && !approved ? (
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                Module {module.name} is not allowed for this user yet. Ticking any right below
                allows the module too (or tick it in Checks Approval).
              </p>
            ) : null}
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-left dark:bg-slate-800">
                  <tr>
                    <th className="px-2 py-1.5">Option Name</th>
                    {(['access', 'add', 'edit', 'delete'] as const).map((r) => (
                      <th key={r} className="px-2 py-1.5 text-center">
                        {RIGHT_LABELS[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-4 text-center text-slate-500 dark:text-slate-400"
                      >
                        {gridTab === 'inputs'
                          ? 'This module has no forms.'
                          : 'This module has no reports.'}
                      </td>
                    </tr>
                  ) : (
                    gridItems.map((item) => (
                      <tr
                        key={item.key}
                        className="border-t border-slate-200 dark:border-slate-700"
                      >
                        <td className="px-2 py-1.5">{item.name}</td>
                        {(['access', 'add', 'edit', 'delete'] as const).map((r) => (
                          <td key={r} className="px-2 py-1.5 text-center">
                            {item.rights.includes(r) ? (
                              <input
                                type="checkbox"
                                aria-label={`${item.name} ${RIGHT_LABELS[r]}`}
                                checked={rightsOf(rights, item.key).includes(r)}
                                disabled={gridDisabled}
                                onChange={(e) => tick(item, r, e.target.checked)}
                              />
                            ) : (
                              <span
                                aria-hidden="true"
                                className="text-slate-300 dark:text-slate-600"
                              >
                                —
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {warnings.length > 0 ? (
              <ul className="border-t border-slate-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-slate-700 dark:bg-amber-900/20 dark:text-amber-200">
                {warnings.map((w) => (
                  <li key={w.item}>
                    {w.item} also reads from {w.needs.join(', ')}. Without Access to{' '}
                    {w.needs.length > 1 ? 'those' : 'that'}, parts of that screen will show
                    "permission denied".
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      {/* print-only summary */}
      {loaded ? (
        <section className="hidden print:block">
          <h1 className="text-xl font-bold">Security Panel - {loaded.loginId}</h1>
          <p>
            {loaded.displayName} · {loaded.storeName ?? 'No location'} ·{' '}
            {loaded.categoryName ?? 'No user type'} · {loaded.status}
          </p>
          {registry.modules
            .filter((m) => isModuleApproved(rights, m.key))
            .map((m) => (
              <div key={m.key} className="mt-2">
                <h2 className="font-semibold">
                  {m.prefix} - {m.name}
                </h2>
                <ul className="ml-5 list-disc">
                  {m.items
                    .filter((i) => rightsOf(rights, i.key).length > 0)
                    .map((i) => (
                      <li key={i.key}>
                        {i.name}:{' '}
                        {rightsOf(rights, i.key)
                          .map((r) => RIGHT_LABELS[r])
                          .join(', ')}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </section>
      ) : null}

      {searchOpen ? (
        <UserSearchModal
          api={api}
          onClose={() => setSearchOpen(false)}
          onPick={(id) => {
            setSearchOpen(false);
            void loadUser(id);
          }}
        />
      ) : null}
      {detailOpen && loaded ? (
        <Modal title={`Rights Detail - ${loaded.loginId}`} onClose={() => setDetailOpen(false)}>
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
            These are the permissions the server enforces for this user right now (
            {loaded.effectivePermissions.length}).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {loaded.effectivePermissions.map((p) => (
              <code
                key={p}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800"
              >
                {p}
              </code>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
};

const UserSearchModal = ({
  api,
  onClose,
  onPick,
}: {
  api: UserApi;
  onClose: () => void;
  onPick: (id: string) => void;
}) => {
  const [q, setQ] = useState('');
  const [includeDisabled, setIncludeDisabled] = useState(true);
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await api.users({ q: q.trim() || undefined, includeDisabled });
          if (!cancelled) setRows(r);
        } catch (err) {
          if (!cancelled) setError(message(err));
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, includeDisabled]);

  return (
    <Modal title="Search users" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          autoFocus
          aria-label="Search users"
          placeholder="Type a User ID or name"
          className={fieldCls}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex shrink-0 items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={includeDisabled}
            onChange={(e) => setIncludeDisabled(e.target.checked)}
          />{' '}
          Include disabled
        </label>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {rows === null ? (
        <Spinner label="Loading users…" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No users found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1.5">User ID</th>
              <th className="px-2 py-1.5">User Name</th>
              <th className="px-2 py-1.5">User Type</th>
              <th className="px-2 py-1.5">Location</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                onClick={() => onPick(r.id)}
              >
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onPick(r.id)}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {r.loginId}
                  </button>
                </td>
                <td className="px-2 py-1.5">{r.displayName}</td>
                <td className="px-2 py-1.5">{r.categoryName ?? '—'}</td>
                <td className="px-2 py-1.5">{r.storeName ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <Badge tone={r.status === 'ACTIVE' ? 'green' : 'red'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};
