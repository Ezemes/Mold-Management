-- CreateTable
CREATE TABLE "public"."DowntimeCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DowntimeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DowntimeEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "pressId" TEXT,
    "codeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "description" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reportedById" TEXT,
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DowntimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DowntimeCode_orgId_code_key" ON "public"."DowntimeCode"("orgId", "code");

-- CreateIndex
CREATE INDEX "DowntimeEvent_orgId_startedAt_idx" ON "public"."DowntimeEvent"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "DowntimeEvent_assetId_startedAt_idx" ON "public"."DowntimeEvent"("assetId", "startedAt");

-- CreateIndex
CREATE INDEX "DowntimeEvent_workOrderId_idx" ON "public"."DowntimeEvent"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DowntimeEvent_orgId_number_key" ON "public"."DowntimeEvent"("orgId", "number");

-- AddForeignKey
ALTER TABLE "public"."DowntimeCode" ADD CONSTRAINT "DowntimeCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_pressId_fkey" FOREIGN KEY ("pressId") REFERENCES "public"."Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "public"."DowntimeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "public"."WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
