-- POS extras: sale references and charges, per-line salesman, vouchers / credit memos. Additive only.

-- CreateEnum
CREATE TYPE "VoucherKind" AS ENUM ('DISCOUNT', 'CREDIT_MEMO');
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'USED', 'CANCELLED');

-- AlterTable
ALTER TABLE "sales"
  ADD COLUMN "orderRef" TEXT,
  ADD COLUMN "fbrInvoiceNo" TEXT,
  ADD COLUMN "creditNoteRef" TEXT,
  ADD COLUMN "serviceFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "otherCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "roundingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "voucherAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "voucherRefs" TEXT;

ALTER TABLE "sale_items" ADD COLUMN "salesman" TEXT;

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vouchers_balance_check" CHECK ("balance" >= 0 AND "balance" <= "amount")
);

CREATE UNIQUE INDEX "vouchers_tenantId_code_key" ON "vouchers"("tenantId", "code");
CREATE UNIQUE INDEX "vouchers_id_tenantId_key" ON "vouchers"("id", "tenantId");
CREATE INDEX "vouchers_tenantId_kind_status_idx" ON "vouchers"("tenantId", "kind", "status");

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
