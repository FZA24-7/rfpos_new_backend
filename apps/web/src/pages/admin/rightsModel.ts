// Pure logic of the Security File rights grid (no React), so it can be unit-tested.
import type {
  Registry,
  RegistryItem,
  RegistryModule,
  Right,
  RightsSelection,
} from '../../api/admin.js';

export const emptySelection = (): RightsSelection => ({ modules: [], items: {} });

export const cloneSelection = (s: RightsSelection): RightsSelection => ({
  modules: [...s.modules],
  items: Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, [...v]])),
});

export const isModuleApproved = (sel: RightsSelection, moduleKey: string): boolean =>
  sel.modules.includes(moduleKey);

/** Approving a module changes nothing else; un-approving it removes every right inside it (nothing stays granted). */
export const setModuleApproved = (
  sel: RightsSelection,
  module: RegistryModule,
  approved: boolean,
): RightsSelection => {
  const next = cloneSelection(sel);
  if (approved) {
    if (!next.modules.includes(module.key)) next.modules.push(module.key);
  } else {
    next.modules = next.modules.filter((m) => m !== module.key);
    for (const item of module.items) delete next.items[item.key];
  }
  return next;
};

/**
 * Ticks / unticks one right. Add, Edit and Delete need Access, so ticking them also ticks Access and unticking Access
 * clears them. Rights the item does not support, and items of an unapproved module, are ignored.
 */
export const toggleRight = (
  sel: RightsSelection,
  module: RegistryModule,
  item: RegistryItem,
  right: Right,
  on: boolean,
): RightsSelection => {
  if (!item.rights.includes(right) || !sel.modules.includes(module.key)) return sel;
  const next = cloneSelection(sel);
  const current = new Set<Right>(next.items[item.key] ?? []);
  if (on) {
    current.add(right);
    current.add('access');
  } else if (right === 'access') {
    current.clear();
  } else {
    current.delete(right);
  }
  if (current.size === 0) delete next.items[item.key];
  else next.items[item.key] = item.rights.filter((r) => current.has(r));
  return next;
};

export const rightsOf = (sel: RightsSelection, itemKey: string): Right[] =>
  sel.items[itemKey] ?? [];

export const sameSelection = (a: RightsSelection, b: RightsSelection): boolean =>
  JSON.stringify([[...a.modules].sort(), Object.entries(a.items).sort()]) ===
  JSON.stringify([[...b.modules].sort(), Object.entries(b.items).sort()]);

/** Items the chosen forms read from but that the user cannot access (shown as a warning, never granted silently). */
export const missingDependencies = (
  registry: Registry,
  sel: RightsSelection,
): { item: string; needs: string[] }[] => {
  const all = new Map(registry.modules.flatMap((m) => m.items.map((i) => [i.key, i] as const)));
  const out: { item: string; needs: string[] }[] = [];
  for (const [key, rights] of Object.entries(sel.items)) {
    if (!rights.includes('access')) continue;
    const item = all.get(key);
    if (!item) continue;
    const needs = item.uses
      .filter((u) => !(sel.items[u] ?? []).includes('access'))
      .map((u) => all.get(u)?.name ?? u);
    if (needs.length > 0) out.push({ item: item.name, needs });
  }
  return out;
};

export const itemsByKind = (module: RegistryModule, kind: 'form' | 'report'): RegistryItem[] =>
  module.items.filter((i) => i.kind === kind);

export const grantedCount = (sel: RightsSelection, module: RegistryModule): number =>
  module.items.filter((i) => (sel.items[i.key] ?? []).length > 0).length;

/** Approves a module and ticks every right of every form and report in it (Master Admin shortcut). */
export const grantModuleAll = (sel: RightsSelection, module: RegistryModule): RightsSelection => {
  const next = cloneSelection(sel);
  if (!next.modules.includes(module.key)) next.modules.push(module.key);
  for (const item of module.items) {
    if (item.rights.length > 0) next.items[item.key] = [...item.rights];
  }
  return next;
};

/** Removes the module approval and every right inside it. */
export const clearModule = (sel: RightsSelection, module: RegistryModule): RightsSelection =>
  setModuleApproved(sel, module, false);

export const grantEverything = (sel: RightsSelection, registry: Registry): RightsSelection =>
  registry.modules.reduce((s, m) => grantModuleAll(s, m), sel);

export const clearEverything = (sel: RightsSelection, registry: Registry): RightsSelection =>
  registry.modules.reduce((s, m) => clearModule(s, m), sel);

/** Ticks (or clears) one right for every item currently shown in the grid. */
export const setColumn = (
  sel: RightsSelection,
  module: RegistryModule,
  items: RegistryItem[],
  right: Right,
  on: boolean,
): RightsSelection => {
  let s = on ? setModuleApproved(sel, module, true) : sel;
  for (const item of items) s = toggleRight(s, module, item, right, on);
  return s;
};
