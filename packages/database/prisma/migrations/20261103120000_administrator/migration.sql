-- Administrator module: Security File rights, user categories, SMS log, overhead runs.

-- CreateTable
CREATE TABLE "user_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fbrPosId" TEXT,
    "macAddress" TEXT,
    "userCategoryId" TEXT,
    "counterPos" TEXT,
    "port" INTEGER,
    "fbrToken" TEXT,
    "pcSerial" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_module_access" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,

    CONSTRAINT "user_module_access_pkey" PRIMARY KEY ("userId","moduleKey")
);

-- CreateTable
CREATE TABLE "user_item_rights" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "canAccess" BOOLEAN NOT NULL DEFAULT false,
    "canAdd" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_item_rights_pkey" PRIMARY KEY ("userId","itemKey")
);

-- CreateTable
CREATE TABLE "sms_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overhead_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "totalExpenses" DECIMAL(18,2) NOT NULL,
    "totalSales" DECIMAL(18,2) NOT NULL,
    "ratePercent" DECIMAL(9,4) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overhead_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_categories_tenantId_code_key" ON "user_categories"("tenantId", "code");

-- CreateIndex
CREATE INDEX "user_profiles_tenantId_idx" ON "user_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "user_module_access_tenantId_idx" ON "user_module_access"("tenantId");

-- CreateIndex
CREATE INDEX "user_item_rights_tenantId_idx" ON "user_item_rights"("tenantId");

-- CreateIndex
CREATE INDEX "sms_logs_tenantId_createdAt_idx" ON "sms_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "overhead_runs_tenantId_createdAt_idx" ON "overhead_runs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userCategoryId_fkey" FOREIGN KEY ("userCategoryId") REFERENCES "user_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_item_rights" ADD CONSTRAINT "user_item_rights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overhead_runs" ADD CONSTRAINT "overhead_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
