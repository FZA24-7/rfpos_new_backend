import { useState } from 'react';
import { DeskModal, DeskInput } from './DeskWindow.js';
import type { DeskShop } from './deskApi.js';

/** The magnifier next to a Shop box: search the shops by name or code and pick one. */
export const ShopPicker = ({
  shops,
  onPick,
  onClose,
}: {
  shops: DeskShop[];
  onPick: (shop: DeskShop) => void;
  onClose: () => void;
}) => {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = shops.filter(
    (s) => !needle || `${s.name} ${s.code} ${s.region ?? ''}`.toLowerCase().includes(needle),
  );
  return (
    <DeskModal title="Find shop" onClose={onClose} width="max-w-md" testId="shop-picker">
      <div className="space-y-3 p-4">
        <DeskInput
          autoFocus
          aria-label="Search shops"
          placeholder="Shop name or code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-64 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {list.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-slate-500">No shop matches.</li>
          ) : null}
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="focus-ring flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-800"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-slate-500">
                  {s.code}
                  {s.region ? ` · ${s.region}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </DeskModal>
  );
};
