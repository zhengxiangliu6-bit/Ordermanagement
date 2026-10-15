-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "nextSendAt" TIMESTAMP(3),
ADD COLUMN     "policyMode" TEXT,
ADD COLUMN     "ruleVersion" INTEGER;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "shippingPolicyOverride" JSONB;

-- CreateTable
CREATE TABLE "ShippingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "externalTimezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "initialSyncPolicy" TEXT NOT NULL DEFAULT 'review_then_immediate',
    "revisionSyncPolicy" TEXT NOT NULL DEFAULT 'review_then_scheduled',
    "schedule" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_remoteSyncStatus_nextSendAt_idx" ON "Shipment"("remoteSyncStatus", "nextSendAt");
