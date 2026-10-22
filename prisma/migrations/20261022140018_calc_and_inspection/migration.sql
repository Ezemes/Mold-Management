-- AlterTable
ALTER TABLE "public"."Asset" ADD COLUMN     "annualVolume" INTEGER,
ADD COLUMN     "brandName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "componentType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customerToolNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "estimatedNewToolCost" DECIMAL(14,2),
ADD COLUMN     "lastRunDate" TIMESTAMP(3),
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "process" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "productDrawing" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "utilizationPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."ConditionEvaluation" ADD COLUMN     "answers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'bench',
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "public"."Organisation" ADD COLUMN     "cavityCostCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "cavityCosts" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "public"."Site" ADD COLUMN     "daysPerWeek" INTEGER,
ADD COLUMN     "hoursPerShift" DOUBLE PRECISION,
ADD COLUMN     "oeePct" DOUBLE PRECISION,
ADD COLUMN     "shiftsPerDay" INTEGER,
ADD COLUMN     "weeksPerYear" INTEGER;

-- CreateTable
CREATE TABLE "public"."InspectionTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "processes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "components" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionTemplate_orgId_name_key" ON "public"."InspectionTemplate"("orgId", "name");

-- AddForeignKey
ALTER TABLE "public"."InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
