import { describe, expect, it } from 'vitest';
import type { Registry, RegistryItem, RegistryModule } from '../api/admin.js';
import {
  emptySelection,
  grantedCount,
  isModuleApproved,
  missingDependencies,
  sameSelection,
  setModuleApproved,
  toggleRight,
} from '../pages/admin/rightsModel.js';

const pos: RegistryItem = {
  key: 'POS',
  name: 'POS',
  kind: 'form',
  rights: ['access', 'add'],
  uses: ['PRODUCTS'],
};
const products: RegistryItem = {
  key: 'PRODUCTS',
  name: 'PRODUCTS',
  kind: 'form',
  rights: ['access', 'add', 'edit', 'delete'],
  uses: [],
};
const sale: RegistryModule = { key: 'SALE', prefix: 'SALE', name: 'SALE', items: [pos] };
const master: RegistryModule = {
  key: 'MASTER',
  prefix: 'MASTER',
  name: 'MASTER',
  items: [products],
};
const registry: Registry = {
  rights: ['access', 'add', 'edit', 'delete'],
  baseline: [],
  modules: [sale, master],
};

describe('Security File rights model', () => {
  it('grants nothing by default', () => {
    const s = emptySelection();
    expect(s.modules).toEqual([]);
    expect(grantedCount(s, sale)).toBe(0);
  });

  it('ignores rights in a module that is not approved', () => {
    const s = toggleRight(emptySelection(), sale, pos, 'access', true);
    expect(s.items).toEqual({});
  });

  it('ticking Add also ticks Access; unticking Access clears everything', () => {
    let s = setModuleApproved(emptySelection(), sale, true);
    s = toggleRight(s, sale, pos, 'add', true);
    expect(s.items.POS).toEqual(['access', 'add']);
    s = toggleRight(s, sale, pos, 'access', false);
    expect(s.items.POS).toBeUndefined();
  });

  it('ignores a right the form does not support', () => {
    let s = setModuleApproved(emptySelection(), sale, true);
    s = toggleRight(s, sale, pos, 'delete', true);
    expect(s.items.POS).toBeUndefined();
  });

  it('un-approving a module removes every right inside it and leaves other modules alone', () => {
    let s = setModuleApproved(setModuleApproved(emptySelection(), sale, true), master, true);
    s = toggleRight(s, sale, pos, 'access', true);
    s = toggleRight(s, master, products, 'edit', true);
    s = setModuleApproved(s, sale, false);
    expect(isModuleApproved(s, 'SALE')).toBe(false);
    expect(s.items.POS).toBeUndefined();
    expect(s.items.PRODUCTS).toEqual(['access', 'edit']);
  });

  it('does not mutate its input', () => {
    const base = setModuleApproved(emptySelection(), sale, true);
    const frozen = JSON.stringify(base);
    toggleRight(base, sale, pos, 'access', true);
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it('warns about forms a granted form reads from, without granting them', () => {
    let s = setModuleApproved(emptySelection(), sale, true);
    s = toggleRight(s, sale, pos, 'access', true);
    expect(missingDependencies(registry, s)).toEqual([{ item: 'POS', needs: ['PRODUCTS'] }]);
    expect(s.items.PRODUCTS).toBeUndefined();
  });

  it('compares selections regardless of order', () => {
    const a = { modules: ['A', 'B'], items: { X: ['access' as const] } };
    const b = { modules: ['B', 'A'], items: { X: ['access' as const] } };
    expect(sameSelection(a, b)).toBe(true);
    expect(sameSelection(a, emptySelection())).toBe(false);
  });
});
