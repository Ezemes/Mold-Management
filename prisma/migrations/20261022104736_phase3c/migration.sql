-- AlterTable
ALTER TABLE "public"."Asset" ADD COLUMN     "conditionDate" TIMESTAMP(3),
ADD COLUMN     "conditionScore" DOUBLE PRECISION,
ADD COLUMN     "locatingRingMm" DOUBLE PRECISION,
ADD COLUMN     "maxMoldHeightMm" DOUBLE PRECISION,
ADD COLUMN     "maxMoldWeightKg" DOUBLE PRECISION,
ADD COLUMN     "maxOpeningMm" DOUBLE PRECISION,
ADD COLUMN     "minMoldHeightMm" DOUBLE PRECISION,
ADD COLUMN     "nextEvaluationDate" TIMESTAMP(3),
ADD COLUMN     "nozzleRadiusMm" DOUBLE PRECISION,
ADD COLUMN     "openingStrokeMm" DOUBLE PRECISION,
ADD COLUMN     "platenHMm" DOUBLE PRECISION,
ADD COLUMN     "platenWMm" DOUBLE PRECISION,
ADD COLUMN     "requalificationReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "shotCapacityG" DOUBLE PRECISION,
ADD COLUMN     "sprueRadiusMm" DOUBLE PRECISION,
ADD COLUMN     "stackHeightMm" DOUBLE PRECISION,
ADD COLUMN     "tieBarHMm" DOUBLE PRECISION,
ADD COLUMN     "tieBarVMm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."AssetType" ADD COLUMN     "budgetRules" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "evalCriteria" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "evalIntervalDays" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "evalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "public"."Organisation" ADD COLUMN     "capacityHoursPerMonth" INTEGER NOT NULL DEFAULT 600,
ADD COLUMN     "compatRules" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "defaultOeePct" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN     "refurbDowntimeDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "requalifyOnTransfer" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."WorkOrderPart" ADD COLUMN     "partId" TEXT,
ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "public"."MoldPress" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "moldId" TEXT NOT NULL,
    "pressId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "qualificationId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedReason" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MoldPress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConditionEvaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "scores" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "shots" INTEGER,
    "evaluatedById" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConditionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Qualification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "pressId" TEXT,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QualificationStage" (
    "id" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ownerId" TEXT,
    "plannedDate" TIMESTAMP(3),
    "actualDate" TIMESTAMP(3),
    "result" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "QualificationStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Part" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "mfrPartNumber" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderPoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shelfLifeDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PartAsset" (
    "partId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "PartAsset_pkey" PRIMARY KEY ("partId","assetId")
);

-- CreateTable
CREATE TABLE "public"."Stock" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "bin" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderPoint" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockMove" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "workOrderId" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BudgetItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'rule',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductDemand" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDemand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoldPress_moldId_pressId_key" ON "public"."MoldPress"("moldId", "pressId");

-- CreateIndex
CREATE INDEX "ConditionEvaluation_assetId_evaluatedAt_idx" ON "public"."ConditionEvaluation"("assetId", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_orgId_number_key" ON "public"."Qualification"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationStage_qualificationId_stage_key" ON "public"."QualificationStage"("qualificationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Part_orgId_number_key" ON "public"."Part"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_partId_siteId_key" ON "public"."Stock"("partId", "siteId");

-- CreateIndex
CREATE INDEX "StockMove_partId_createdAt_idx" ON "public"."StockMove"("partId", "createdAt");

-- CreateIndex
CREATE INDEX "BudgetItem_orgId_year_idx" ON "public"."BudgetItem"("orgId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetItem_assetId_year_category_key" ON "public"."BudgetItem"("assetId", "year", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDemand_orgId_partNumber_month_key" ON "public"."ProductDemand"("orgId", "partNumber", "month");

-- AddForeignKey
ALTER TABLE "public"."WorkOrderPart" ADD CONSTRAINT "WorkOrderPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MoldPress" ADD CONSTRAINT "MoldPress_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MoldPress" ADD CONSTRAINT "MoldPress_moldId_fkey" FOREIGN KEY ("moldId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MoldPress" ADD CONSTRAINT "MoldPress_pressId_fkey" FOREIGN KEY ("pressId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConditionEvaluation" ADD CONSTRAINT "ConditionEvaluation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConditionEvaluation" ADD CONSTRAINT "ConditionEvaluation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Qualification" ADD CONSTRAINT "Qualification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Qualification" ADD CONSTRAINT "Qualification_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Qualification" ADD CONSTRAINT "Qualification_pressId_fkey" FOREIGN KEY ("pressId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QualificationStage" ADD CONSTRAINT "QualificationStage_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "public"."Qualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Part" ADD CONSTRAINT "Part_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PartAsset" ADD CONSTRAINT "PartAsset_partId_fkey" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PartAsset" ADD CONSTRAINT "PartAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Stock" ADD CONSTRAINT "Stock_partId_fkey" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Stock" ADD CONSTRAINT "Stock_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMove" ADD CONSTRAINT "StockMove_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMove" ADD CONSTRAINT "StockMove_partId_fkey" FOREIGN KEY ("partId") REFERENCES "public"."Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BudgetItem" ADD CONSTRAINT "BudgetItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BudgetItem" ADD CONSTRAINT "BudgetItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductDemand" ADD CONSTRAINT "ProductDemand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
