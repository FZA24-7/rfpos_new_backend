import type { Prisma, PrismaClient } from '@mafk/database';
import type { VoucherRepository } from '../../domain/ports.js';
import {
  VoucherRedeemError,
  type IssueVoucherRecordInput,
  type VoucherListFilter,
  type VoucherRecord,
} from '../../domain/types.js';

type Row = Prisma.VoucherGetPayload<object>;

export const toVoucher = (r: Row): VoucherRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  code: r.code,
  kind: r.kind,
  amount: r.amount.toFixed(2),
  balance: r.balance.toFixed(2),
  status: r.status,
  expiresAt: r.expiresAt,
  note: r.note,
  createdAt: r.createdAt,
});

/**
 * Takes `amount` off a voucher inside the caller's transaction. The conditional update only succeeds while the
 * voucher is ACTIVE, not expired and holds at least `amount`, so two sales can never spend the same balance.
 */
export async function redeemVoucherInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  code: string,
  amount: string,
): Promise<void> {
  const taken = await tx.voucher.updateMany({
    where: {
      tenantId,
      code,
      status: 'ACTIVE',
      balance: { gte: amount },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: { balance: { decrement: amount } },
  });
  if (taken.count !== 1) {
    throw new VoucherRedeemError(
      `Voucher ${code} cannot be used (not valid, expired, or used up).`,
    );
  }
  await tx.voucher.updateMany({
    where: { tenantId, code, balance: 0, status: 'ACTIVE' },
    data: { status: 'USED' },
  });
}

export class PrismaVoucherRepository implements VoucherRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(input: IssueVoucherRecordInput): Promise<VoucherRecord> {
    const row = await this.prisma.voucher.create({
      data: {
        tenantId: input.tenantId,
        code: input.code,
        kind: input.kind,
        amount: input.amount,
        balance: input.amount,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
        issuedById: input.issuedById,
      },
    });
    return toVoucher(row);
  }

  async findByCode(tenantId: string, code: string): Promise<VoucherRecord | null> {
    const row = await this.prisma.voucher.findFirst({ where: { tenantId, code } });
    return row ? toVoucher(row) : null;
  }

  async list(tenantId: string, f: VoucherListFilter) {
    const where: Prisma.VoucherWhereInput = {
      tenantId,
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.search ? { code: { contains: f.search.toUpperCase() } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.voucher.count({ where }),
    ]);
    return { items: rows.map(toVoucher), total, page: f.page, pageSize: f.pageSize };
  }

  async cancel(tenantId: string, code: string): Promise<VoucherRecord | null> {
    const res = await this.prisma.voucher.updateMany({
      where: { tenantId, code, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    if (res.count !== 1) return null;
    return this.findByCode(tenantId, code);
  }
}
