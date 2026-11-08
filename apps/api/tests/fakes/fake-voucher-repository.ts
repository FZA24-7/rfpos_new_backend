import { randomUUID } from 'node:crypto';
import { compareDecimalStrings, subtractDecimalStrings } from '@mafk/shared';
import type { VoucherRepository } from '../../src/domain/ports.js';
import {
  VoucherRedeemError,
  type IssueVoucherRecordInput,
  type VoucherListFilter,
  type VoucherRecord,
} from '../../src/domain/types.js';

export class FakeVoucherRepository implements VoucherRepository {
  readonly vouchers = new Map<string, VoucherRecord>();

  /** Snapshot for the sale "transaction": returns a restore function. */
  snapshot(): () => void {
    const copy = structuredClone([...this.vouchers]);
    return () => {
      this.vouchers.clear();
      copy.forEach(([k, v]) => this.vouchers.set(k, v));
    };
  }

  private key(tenantId: string, code: string): string {
    return `${tenantId}:${code}`;
  }

  issue(input: IssueVoucherRecordInput): Promise<VoucherRecord> {
    const k = this.key(input.tenantId, input.code);
    if (this.vouchers.has(k)) {
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    const v: VoucherRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      code: input.code,
      kind: input.kind,
      amount: input.amount,
      balance: input.amount,
      status: 'ACTIVE',
      expiresAt: input.expiresAt ?? null,
      note: input.note ?? null,
      createdAt: new Date(),
    };
    this.vouchers.set(k, v);
    return Promise.resolve(structuredClone(v));
  }

  findByCode(tenantId: string, code: string): Promise<VoucherRecord | null> {
    const v = this.vouchers.get(this.key(tenantId, code));
    return Promise.resolve(v ? structuredClone(v) : null);
  }

  list(tenantId: string, f: VoucherListFilter) {
    const all = [...this.vouchers.values()]
      .filter((v) => v.tenantId === tenantId)
      .filter((v) => !f.kind || v.kind === f.kind)
      .filter((v) => !f.status || v.status === f.status)
      .filter((v) => !f.search || v.code.includes(f.search.toUpperCase()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
    return Promise.resolve({
      items: structuredClone(items),
      total: all.length,
      page: f.page,
      pageSize: f.pageSize,
    });
  }

  cancel(tenantId: string, code: string): Promise<VoucherRecord | null> {
    const v = this.vouchers.get(this.key(tenantId, code));
    if (!v || v.status !== 'ACTIVE') return Promise.resolve(null);
    v.status = 'CANCELLED';
    return Promise.resolve(structuredClone(v));
  }

  /** Same rule as the SQL conditional update. */
  redeem(tenantId: string, code: string, amount: string): void {
    const v = this.vouchers.get(this.key(tenantId, code));
    const ok =
      v &&
      v.status === 'ACTIVE' &&
      compareDecimalStrings(v.balance, amount, 2) >= 0 &&
      (!v.expiresAt || v.expiresAt.getTime() > Date.now());
    if (!ok) {
      throw new VoucherRedeemError(
        `Voucher ${code} cannot be used (not valid, expired, or used up).`,
      );
    }
    v.balance = subtractDecimalStrings(v.balance, amount, 2);
    if (compareDecimalStrings(v.balance, '0', 2) === 0) v.status = 'USED';
  }
}
