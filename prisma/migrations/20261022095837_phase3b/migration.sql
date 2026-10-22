-- AlterTable
ALTER TABLE "public"."Asset" ADD COLUMN     "lastRefurbDate" TIMESTAMP(3),
ADD COLUMN     "lastRefurbShots" INTEGER;

-- AlterTable
ALTER TABLE "public"."Organisation" ADD COLUMN     "transferApproval" TEXT NOT NULL DEFAULT 'cross_company',
ADD COLUMN     "transferShotTolerance" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "public"."Transfer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL DEFAULT 'production_move',
    "fromSiteId" TEXT NOT NULL,
    "fromPartnerId" TEXT,
    "toSiteId" TEXT NOT NULL,
    "toPartnerId" TEXT,
    "toLocationDetail" TEXT NOT NULL DEFAULT '',
    "neededBy" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "carrier" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "vehicleNumber" TEXT NOT NULL DEFAULT '',
    "ewayBillNumber" TEXT NOT NULL DEFAULT '',
    "eta" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Handover" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "shotReading" INTEGER,
    "lifetimeShots" INTEGER,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "conditionOk" BOOLEAN NOT NULL DEFAULT true,
    "accessories" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "tagVerified" BOOLEAN NOT NULL DEFAULT false,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Dispute" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "outboundShots" INTEGER,
    "inboundShots" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT NOT NULL DEFAULT '',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaintenanceTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'preventive',
    "description" TEXT NOT NULL DEFAULT '',
    "estimatedHours" DOUBLE PRECISION,
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaintenancePlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "leadPct" INTEGER NOT NULL DEFAULT 90,
    "baselineShots" INTEGER NOT NULL DEFAULT 0,
    "baselineDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warnedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assignedUserId" TEXT,
    "assignedPartnerId" TEXT,
    "planId" TEXT,
    "templateId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "scheduledDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "dueAtShots" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "shotsAtCompletion" INTEGER,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "passPct" DOUBLE PRECISION,
    "rootCause" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "externalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "clearsQuarantine" BOOLEAN NOT NULL DEFAULT false,
    "signedByName" TEXT NOT NULL DEFAULT '',
    "signedAt" TIMESTAMP(3),
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrderLabor" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT,
    "workerName" TEXT NOT NULL DEFAULT '',
    "hours" DOUBLE PRECISION NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderLabor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrderPart" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Attachment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_orgId_status_idx" ON "public"."Transfer"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_orgId_number_key" ON "public"."Transfer"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TransferItem_transferId_assetId_key" ON "public"."TransferItem"("transferId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_itemId_direction_key" ON "public"."Handover"("itemId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceTemplate_orgId_name_key" ON "public"."MaintenanceTemplate"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlan_assetId_templateId_key" ON "public"."MaintenancePlan"("assetId", "templateId");

-- CreateIndex
CREATE INDEX "WorkOrder_orgId_status_idx" ON "public"."WorkOrder"("orgId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_assetId_status_idx" ON "public"."WorkOrder"("assetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_orgId_number_key" ON "public"."WorkOrder"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "public"."Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "public"."Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "public"."Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "public"."Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "public"."Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transfer" ADD CONSTRAINT "Transfer_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "public"."Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransferItem" ADD CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "public"."Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransferItem" ADD CONSTRAINT "TransferItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Handover" ADD CONSTRAINT "Handover_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."TransferItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dispute" ADD CONSTRAINT "Dispute_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."TransferItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenanceTemplate" ADD CONSTRAINT "MaintenanceTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."MaintenanceTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_assignedPartnerId_fkey" FOREIGN KEY ("assignedPartnerId") REFERENCES "public"."Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."MaintenancePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."MaintenanceTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrderLabor" ADD CONSTRAINT "WorkOrderLabor_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "public"."WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrderLabor" ADD CONSTRAINT "WorkOrderLabor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrderPart" ADD CONSTRAINT "WorkOrderPart_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "public"."WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attachment" ADD CONSTRAINT "Attachment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
