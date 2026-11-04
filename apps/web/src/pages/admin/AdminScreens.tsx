import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  adminApi,
  type AuditRow,
  type BankRow,
  type CategoryRow,
  type LocationRow,
  type LocksState,
  type LogFilter,
  type Lookups,
  type OverheadRow,
  type PeriodState,
  type SmsRow,
  type UserRow,
} from '../../api/admin.js';
import { useAuth } from '../../state/auth.js';
import { can } from '../../state/permissions.js';
import { Card, CardBody } from '../../components/ui/Card.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Input, Label } from '../../components/ui/Input.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { AdminFrame, bodyRow, errText, headRow, selectClass, Th } from './AdminFrame.js';

type Props = { onExit: () => void };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');
const when = (iso: string): string => new Date(iso).toLocaleString();

/* ---------------------------------------------------------------- User Category */
export const UserCategoryPage = ({ onExit }: Props) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryRow | 'new' | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await adminApi.categories());
    } catch (e) {
      setError(errText(e, 'Failed to load user categories.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const open = (c: CategoryRow | 'new') => {
    setEditing(c);
    setCode(c === 'new' ? '' : c.code);
    setName(c === 'new' ? '' : c.name);
    setError(null);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editing === 'new') await adminApi.createCategory({ code, name });
      else if (editing) await adminApi.updateCategory(editing.id, { code, name });
      setEditing(null);
      await load();
    } catch (err) {
      setError(errText(err, 'Failed to save the category.'));
    }
  };
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errText(err, fallback));
    }
  };

  return (
    <AdminFrame title="User Category" onExit={onExit} error={error}>
      {can(user, 'user_category.create') ? (
        <Button onClick={() => open('new')}>
          <Plus size={16} /> New Category
        </Button>
      ) : null}
      {editing ? (
        <Card>
          <CardBody>
            <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-3" noValidate>
              <div>
                <Label htmlFor="uc-code">Code</Label>
                <Input id="uc-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="uc-name">Name</Label>
                <Input id="uc-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit">Save</Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState title="No user categories" description="Create one to classify users." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Users</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={bodyRow}>
                    <td className="py-2.5 pr-4 font-mono">{c.code}</td>
                    <td className="py-2.5 pr-4 font-medium">{c.name}</td>
                    <td className="py-2.5 pr-4">{c.userCount}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={c.isActive ? 'green' : 'slate'}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="space-x-2 py-2.5 text-right">
                      {can(user, 'user_category.edit') ? (
                        <>
                          <Button variant="secondary" onClick={() => open(c)}>
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void run(
                                () => adminApi.updateCategory(c.id, { isActive: !c.isActive }),
                                'Failed to update the category.',
                              )
                            }
                          >
                            {c.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </>
                      ) : null}
                      {can(user, 'user_category.delete') ? (
                        <Button
                          variant="danger"
                          onClick={() =>
                            void run(
                              () => adminApi.deleteCategory(c.id),
                              'Failed to delete the category.',
                            )
                          }
                        >
                          Delete
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Update User Location */
export const UpdateUserLocationPage = ({ onExit }: Props) => {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [userId, setUserId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [u, l] = await Promise.all([adminApi.users({}), adminApi.lookups()]);
        setUsers(u);
        setLookups(l);
      } catch (e) {
        setError(errText(e, 'Failed to load users and locations.'));
      }
    })();
  }, []);

  const pick = (id: string) => {
    setUserId(id);
    setNotice(null);
    setStoreId(users?.find((u) => u.id === id)?.storeId ?? '');
  };
  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      await adminApi.setUserLocation(userId, storeId);
      setUsers(await adminApi.users({}));
      setNotice('User location updated. It applies from the user’s next sign-in.');
    } catch (e) {
      setError(errText(e, 'Failed to update the user location.'));
    }
  };

  return (
    <AdminFrame title="Update User Location" onExit={onExit} error={error} notice={notice}>
      <Card>
        <CardBody>
          {!users || !lookups ? (
            <Spinner label="Loading…" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="ul-user">User</Label>
                <select
                  id="ul-user"
                  className={selectClass}
                  value={userId}
                  onChange={(e) => pick(e.target.value)}
                >
                  <option value="">Select a user…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.loginId} — {u.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="ul-loc">Location</Label>
                <select
                  id="ul-loc"
                  className={selectClass}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  disabled={!userId}
                >
                  <option value="">Select a location…</option>
                  {lookups.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => void save()} disabled={!userId || !storeId}>
                  Update
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Attribute Locking */
export const AttributeLockingPage = ({ onExit }: Props) => {
  const { user } = useAuth();
  const [state, setState] = useState<LocksState | null>(null);
  const [locked, setLocked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = can(user, 'attribute_locking.edit');

  useEffect(() => {
    void (async () => {
      try {
        const s = await adminApi.locks();
        setState(s);
        setLocked(s.locked);
      } catch (e) {
        setError(errText(e, 'Failed to load attribute locks.'));
      }
    })();
  }, []);

  const toggle = (key: string) =>
    setLocked((l) => (l.includes(key) ? l.filter((k) => k !== key) : [...l, key]));
  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      const s = await adminApi.setLocks(locked);
      setState(s);
      setLocked(s.locked);
      setNotice('Attribute locks saved.');
    } catch (e) {
      setError(errText(e, 'Failed to save attribute locks.'));
    }
  };

  return (
    <AdminFrame title="Attribute Locking" onExit={onExit} error={error} notice={notice}>
      <Card>
        <CardBody>
          {!state ? (
            <Spinner label="Loading…" />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                A locked attribute cannot be changed on an existing product.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {state.attributes.map((a) => (
                  <li key={a.key}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={locked.includes(a.key)}
                        disabled={!canEdit}
                        onChange={() => toggle(a.key)}
                      />
                      {a.label}
                    </label>
                  </li>
                ))}
              </ul>
              {canEdit ? <Button onClick={() => void save()}>Save</Button> : null}
            </div>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Close Period */
export const ClosePeriodPage = ({ onExit }: Props) => {
  const { user } = useAuth();
  const [state, setState] = useState<PeriodState | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await adminApi.period());
    } catch (e) {
      setError(errText(e, 'Failed to load the period.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const close = async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await adminApi.closePeriod(date);
      setNotice(`Transactions dated on or before ${r.closedThrough} are now closed.`);
      await load();
    } catch (e) {
      setError(errText(e, 'Failed to close the period.'));
    }
  };
  const reopen = async () => {
    setError(null);
    setNotice(null);
    try {
      await adminApi.reopenPeriod();
      setNotice('The period is open again.');
      await load();
    } catch (e) {
      setError(errText(e, 'Failed to re-open the period.'));
    }
  };

  return (
    <AdminFrame title="Close Period for Transaction" onExit={onExit} error={error} notice={notice}>
      <Card>
        <CardBody>
          {!state ? (
            <Spinner label="Loading…" />
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                Closed through:{' '}
                <strong>{state.closedThrough ?? 'nothing is closed (all dates are open)'}</strong>
              </p>
              <div className="flex flex-wrap items-end gap-3">
                {can(user, 'period_close.create') ? (
                  <>
                    <div>
                      <Label htmlFor="cp-date">Close through (date)</Label>
                      <Input
                        id="cp-date"
                        type="date"
                        max={state.today}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </div>
                    <Button onClick={() => void close()} disabled={!DATE.test(date)}>
                      Close period
                    </Button>
                  </>
                ) : null}
                {can(user, 'period_close.delete') && state.closedThrough ? (
                  <Button variant="secondary" onClick={() => void reopen()}>
                    Re-open all
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Logs */
const LogFilterBar = ({ onRun }: { onRun: (f: LogFilter) => void }) => {
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const [q, setQ] = useState('');
  return (
    <Card>
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onRun({ from, to, q: q || undefined, limit: 200 });
          }}
        >
          <div>
            <Label htmlFor="lg-from">From</Label>
            <Input
              id="lg-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lg-to">To</Label>
            <Input id="lg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="min-w-[12rem]">
            <Label htmlFor="lg-q">Search</Label>
            <Input id="lg-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" disabled={!DATE.test(from) || !DATE.test(to) || from > to}>
            Show
          </Button>
        </form>
      </CardBody>
    </Card>
  );
};

function useLog<T>(fetcher: (f: LogFilter) => Promise<T[]>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (f: LogFilter) => {
      setError(null);
      try {
        setRows(await fetcher(f));
      } catch (e) {
        setError(errText(e, 'Failed to load the log.'));
      }
    },
    [fetcher],
  );
  useEffect(() => {
    void run({ from: day(-29), to: day(0), limit: 200 });
  }, [run]);
  return { rows, error, run };
}

export const LogFilePage = ({ onExit }: Props) => {
  const { rows, error, run } = useLog<AuditRow>(adminApi.auditLog);
  return (
    <AdminFrame title="Log File" onExit={onExit} error={error}>
      <LogFilterBar onRun={(f) => void run(f)} />
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState title="No log entries" description="Nothing was recorded in this range." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Time</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={bodyRow}>
                    <td className="py-2 pr-4">{when(r.createdAt)}</td>
                    <td className="py-2 pr-4">{r.userLoginId ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono">{r.action}</td>
                    <td className="py-2 pr-4">{r.entity}</td>
                    <td className="py-2 pr-4">{r.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

export const SmsLogPage = ({ onExit }: Props) => {
  const { rows, error, run } = useLog<SmsRow>(adminApi.smsLog);
  return (
    <AdminFrame title="SMS Log" onExit={onExit} error={error}>
      <LogFilterBar onRun={(f) => void run(f)} />
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No SMS messages"
              description="No SMS has been sent from this system in this range."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Time</Th>
                  <Th>Recipient</Th>
                  <Th>Message</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={bodyRow}>
                    <td className="py-2 pr-4">{when(r.createdAt)}</td>
                    <td className="py-2 pr-4">{r.recipient}</td>
                    <td className="py-2 pr-4">{r.message}</td>
                    <td className="py-2 pr-4">{r.error ? `${r.status} — ${r.error}` : r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

export const BankLogPage = ({ onExit }: Props) => {
  const { rows, error, run } = useLog<BankRow>(adminApi.bankLog);
  return (
    <AdminFrame title="Bank Log" onExit={onExit} error={error}>
      <LogFilterBar onRun={(f) => void run(f)} />
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No bank movements"
              description="No card or bank-transfer payments in this range."
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Time</Th>
                  <Th>Source</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th>Document</Th>
                  <Th right>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.at}-${i}`} className={bodyRow}>
                    <td className="py-2 pr-4">{when(r.at)}</td>
                    <td className="py-2 pr-4">
                      {r.source === 'SALE_PAYMENT' ? 'Sale' : 'Expense'}
                    </td>
                    <td className="py-2 pr-4">{r.method}</td>
                    <td className="py-2 pr-4">{r.reference ?? '—'}</td>
                    <td className="py-2 pr-4">{r.documentRef ?? '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Generate Overhead */
export const GenerateOverheadPage = ({ onExit }: Props) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<OverheadRow[] | null>(null);
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminApi.overhead());
    } catch (e) {
      setError(errText(e, 'Failed to load overhead runs.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await adminApi.generateOverhead({ from, to, notes: notes || undefined });
      setNotes('');
      await load();
    } catch (err) {
      setError(errText(err, 'Failed to generate overhead.'));
    }
  };
  const remove = async (id: string) => {
    try {
      await adminApi.deleteOverhead(id);
      await load();
    } catch (err) {
      setError(errText(err, 'Failed to delete the overhead run.'));
    }
  };

  return (
    <AdminFrame title="Generate Overhead" onExit={onExit} error={error}>
      {can(user, 'overhead.create') ? (
        <Card>
          <CardBody>
            <form onSubmit={(e) => void generate(e)} className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="oh-from">From</Label>
                <Input
                  id="oh-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="oh-to">To</Label>
                <Input id="oh-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="min-w-[12rem]">
                <Label htmlFor="oh-notes">Notes</Label>
                <Input id="oh-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button type="submit" disabled={!DATE.test(from) || !DATE.test(to) || from > to}>
                Generate
              </Button>
            </form>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Overhead rate = expenses ÷ net sales × 100 for the chosen dates.
            </p>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState title="No overhead runs" description="Generate one for a date range." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Period</Th>
                  <Th right>Net sales</Th>
                  <Th right>Expenses</Th>
                  <Th right>Rate %</Th>
                  <Th>Notes</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={bodyRow}>
                    <td className="py-2 pr-4">
                      {r.periodFrom.slice(0, 10)} → {r.periodTo.slice(0, 10)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.totalSales}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.totalExpenses}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.ratePercent}</td>
                    <td className="py-2 pr-4">{r.notes ?? '—'}</td>
                    <td className="py-2 text-right">
                      {can(user, 'overhead.delete') ? (
                        <Button variant="danger" onClick={() => void remove(r.id)}>
                          Delete
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};

/* ---------------------------------------------------------------- Locations Status */
export const LocationsStatusPage = ({ onExit }: Props) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminApi.locations());
    } catch (e) {
      setError(errText(e, 'Failed to load locations.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (l: LocationRow) => {
    setError(null);
    try {
      await adminApi.setLocationActive(l.id, !l.isActive);
      await load();
    } catch (e) {
      setError(errText(e, 'Failed to update the location.'));
    }
  };

  return (
    <AdminFrame title="Locations Status" onExit={onExit} error={error}>
      <Card>
        <CardBody>
          {!rows ? (
            <Spinner label="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState title="No locations" description="This business has no locations yet." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={headRow}>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Users</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className={bodyRow}>
                    <td className="py-2.5 pr-4 font-mono">{l.code}</td>
                    <td className="py-2.5 pr-4 font-medium">
                      {l.name} {l.isDefault ? <Badge tone="amber">Default</Badge> : null}
                    </td>
                    <td className="py-2.5 pr-4">{l.userCount}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={l.isActive ? 'green' : 'slate'}>
                        {l.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      {can(user, 'location_status.edit') ? (
                        <Button variant="secondary" onClick={() => void toggle(l)}>
                          {l.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </AdminFrame>
  );
};
