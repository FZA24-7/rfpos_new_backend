import { useState } from 'react';
import type { FormEvent } from 'react';
import { MODULE_CATALOG } from '@mafk/shared';
import { apiRequest, ApiError } from '../api/client.js';
import type { CreateTenantPayload } from '../api/types.js';
import { Button } from './ui/Button.js';
import { Input, Label } from './ui/Input.js';
import { Card, CardBody, CardHeader } from './ui/Card.js';
import { ErrorBanner } from './ui/ErrorBanner.js';

export const CreateTenantForm = ({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('Main Branch');
  const [adminLoginId, setAdminLoginId] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [planCode, setPlanCode] = useState('STANDARD');
  const [maxUsers, setMaxUsers] = useState(10);
  const [maxDevices, setMaxDevices] = useState(5);
  const [maxStores, setMaxStores] = useState(3);
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateTenantPayload = {
        code,
        name,
        defaultStoreName: storeName,
        masterAdmin: { loginId: adminLoginId, password: adminPassword, displayName: adminName },
        license: {
          planCode,
          expiresAt: new Date(expiresAt).toISOString(),
          maxUsers,
          maxDevices,
          maxStores,
          enabledModules: [...MODULE_CATALOG],
        },
      };
      await apiRequest('/master/tenants', { method: 'POST', body: payload });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create client.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          New Client / Tenant
        </h2>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? <ErrorBanner message={error} /> : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="code">Tenant code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ACME"
                required
              />
            </div>
            <div>
              <Label htmlFor="name">Business name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          <div>
            <Label htmlFor="storeName">Default branch name</Label>
            <Input
              id="storeName"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>

          <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Client Master Admin
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="adminLoginId">Login ID</Label>
                <Input
                  id="adminLoginId"
                  value={adminLoginId}
                  onChange={(e) => setAdminLoginId(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="adminName">Display name</Label>
                <Input
                  id="adminName"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="adminPassword">Temporary password</Label>
              <Input
                id="adminPassword"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                minLength={10}
                required
              />
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Initial license
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="planCode">Plan code</Label>
                <Input
                  id="planCode"
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="expiresAt">Expires</Label>
                <Input
                  id="expiresAt"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="maxUsers">Max users</Label>
                <Input
                  id="maxUsers"
                  type="number"
                  min={1}
                  value={maxUsers}
                  onChange={(e) => setMaxUsers(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maxDevices">Max devices</Label>
                <Input
                  id="maxDevices"
                  type="number"
                  min={1}
                  value={maxDevices}
                  onChange={(e) => setMaxDevices(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="maxStores">Max branches</Label>
                <Input
                  id="maxStores"
                  type="number"
                  min={1}
                  value={maxStores}
                  onChange={(e) => setMaxStores(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create client'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
};
