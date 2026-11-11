import { useEffect, useState } from 'react';
import { Eraser, LogOut, MonitorSmartphone } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import {
  DeskInput,
  DeskModal,
  DeskWindow,
  InlineMessage,
  Row,
  SmallButton,
  ToolButton,
} from './DeskWindow.js';
import { errText } from './deskApi.js';

interface UserSerial {
  id: string;
  loginId: string;
  displayName: string;
  systemRole: string;
  status: 'ACTIVE' | 'DISABLED';
  pcSerial: string | null;
}

export const UserPcSerialScreen = ({
  onClose,
  canEdit,
}: {
  onClose: () => void;
  canEdit: boolean;
}) => {
  const [users, setUsers] = useState<UserSerial[]>([]);
  const [selected, setSelected] = useState<UserSerial | null>(null);
  const [serial, setSerial] = useState('');
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = async () => {
    try {
      setUsers((await apiRequest<{ items: UserSerial[] }>('/sale-desk/pc-serials')).items);
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    }
  };
  useEffect(() => {
    void loadUsers();
  }, []);

  const pick = (u: UserSerial) => {
    setSelected(u);
    setSerial(u.pcSerial ?? '-');
    setPicking(false);
    setMsg(null);
  };
  const clear = () => {
    setSelected(null);
    setSerial('');
    setMsg(null);
  };

  const getSerial = async () => {
    const bridge = window.mafkDesktop;
    if (!bridge?.getSerial) {
      return setMsg({
        kind: 'info',
        text: 'Get Serial reads the serial of the computer this app runs on, so it works in the desktop app. In a browser, type the serial of the target PC instead.',
      });
    }
    const s = await bridge.getSerial();
    if (!s)
      return setMsg({
        kind: 'error',
        text: 'The serial number of this computer could not be read.',
      });
    setSerial(s);
    setMsg({
      kind: 'info',
      text: "This computer's serial is shown. Press Update Serial to lock the selected ID to this PC.",
    });
  };

  const update = async () => {
    if (!selected) return setMsg({ kind: 'error', text: 'Choose the user first (List).' });
    setBusy(true);
    try {
      const saved = await apiRequest<UserSerial>(`/sale-desk/pc-serials/${selected.id}`, {
        method: 'PUT',
        body: { serial: serial.trim() === '-' ? '' : serial.trim() },
      });
      setSelected(saved);
      setSerial(saved.pcSerial ?? '-');
      setMsg({
        kind: 'ok',
        text: saved.pcSerial
          ? `${saved.displayName} can now sign in only from the PC with serial ${saved.pcSerial}.`
          : `${saved.displayName} can sign in from any PC.`,
      });
      void loadUsers();
    } catch (e) {
      setMsg({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const needle = filter.trim().toLowerCase();
  const shown = users.filter(
    (u) => !needle || `${u.displayName} ${u.loginId}`.toLowerCase().includes(needle),
  );

  return (
    <>
      <DeskWindow
        title="Serial Update Form"
        icon={MonitorSmartphone}
        onClose={onClose}
        width="max-w-2xl"
        testId="pc-serial"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
              Serial Update Form
            </h3>
            <div className="flex gap-1">
              <ToolButton icon={Eraser} label="Clear" onClick={clear} />
              <ToolButton icon={LogOut} label="Exit" tone="primary" onClick={onClose} />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border border-slate-300 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <Row label="User ID" htmlFor="ps-user" labelWidth="w-32">
              <DeskInput
                id="ps-user"
                readOnly
                value={selected ? `${selected.displayName} (${selected.loginId})` : ''}
                placeholder="Press List to choose a user"
                className="font-semibold"
              />
              <SmallButton onClick={() => setPicking(true)}>List</SmallButton>
            </Row>
            <Row label="User PC Serial #" htmlFor="ps-serial" labelWidth="w-32">
              <DeskInput
                id="ps-serial"
                value={serial}
                maxLength={80}
                disabled={!canEdit}
                onChange={(e) => setSerial(e.target.value)}
              />
              <SmallButton disabled={!canEdit} onClick={() => void getSerial()}>
                Get Serial
              </SmallButton>
              <SmallButton
                tone="primary"
                disabled={!canEdit || busy || !selected}
                onClick={() => void update()}
              >
                Update Serial
              </SmallButton>
            </Row>
          </div>
          {msg ? <InlineMessage kind={msg.kind}>{msg.text}</InlineMessage> : null}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
            <li>
              An ID with a serial can sign in only from that PC — administrators and cashiers alike.
            </li>
            <li>
              Sign in on the target PC, press Get Serial, choose the user and press Update Serial.
            </li>
            <li>
              Enter "-" (or leave the box empty) and press Update Serial to let the ID sign in
              anywhere again.
            </li>
          </ul>
        </div>
      </DeskWindow>
      {picking ? (
        <DeskModal
          title="Users"
          onClose={() => setPicking(false)}
          width="max-w-lg"
          testId="user-list"
        >
          <div className="space-y-3 p-4">
            <DeskInput
              autoFocus
              aria-label="Search users"
              placeholder="Name or ID"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {shown.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-800"
                  >
                    <span>
                      <span className="font-medium">{u.displayName}</span>
                      <span className="ml-2 text-xs text-slate-500">{u.loginId}</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        u.pcSerial
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {u.pcSerial ?? 'Any PC'}
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">No users.</li>
              ) : null}
            </ul>
          </div>
        </DeskModal>
      ) : null}
    </>
  );
};
