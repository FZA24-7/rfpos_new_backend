-- Sale menu: Daily Cash Activity, store regions, PC-serial lock.
ALTER TABLE "users" ADD COLUMN "pcSerial" TEXT;
ALTER TABLE "stores" ADD COLUMN "region" TEXT;

CREATE TABLE "cash_activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "openingPettyCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "receivePettyCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalExpense" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closingPettyCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditCardSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "onAccountSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "redemptionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAvailable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositedCash" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAvailable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expenseLines" JSONB NOT NULL DEFAULT '[]',
    "receiptLines" JSONB NOT NULL DEFAULT '[]',
    "transferLines" JSONB NOT NULL DEFAULT '[]',
    "terminalLines" JSONB NOT NULL DEFAULT '[]',
    "voucherNo" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cash_activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cash_activities_tenantId_storeId_businessDate_key" ON "cash_activities"("tenantId", "storeId", "businessDate");
CREATE INDEX "cash_activities_tenantId_businessDate_idx" ON "cash_activities"("tenantId", "businessDate");
ALTER TABLE "cash_activities" ADD CONSTRAINT "cash_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_activities" ADD CONSTRAINT "cash_activities_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
