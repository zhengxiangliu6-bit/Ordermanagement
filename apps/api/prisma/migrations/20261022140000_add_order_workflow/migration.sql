-- AlterTable
ALTER TABLE "Carrier" ADD COLUMN     "crossBorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orderUrlTemplate" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentStatus" TEXT,
ADD COLUMN     "shippingRegionId" UUID,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'review',
ADD COLUMN     "stageUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stageUpdatedBy" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "inspectedAt" TIMESTAMP(3),
ADD COLUMN     "inspectedBy" TEXT,
ADD COLUMN     "lengthCm" INTEGER,
ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "packedBy" TEXT,
ADD COLUMN     "tailCarrier" TEXT,
ADD COLUMN     "tailEnteredAt" TIMESTAMP(3),
ADD COLUMN     "tailEnteredBy" TEXT,
ADD COLUMN     "tailTrackingNumber" TEXT,
ADD COLUMN     "tailTrackingUrl" TEXT,
ADD COLUMN     "trackingEnteredAt" TIMESTAMP(3),
ADD COLUMN     "trackingEnteredBy" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedBy" TEXT,
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthCm" INTEGER,
ALTER COLUMN "enteredBy" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ShippingRegion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStageEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "stageAtReport" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reportedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "copiedOrderId" UUID,

    CONSTRAINT "ProblemItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRegion_name_key" ON "ShippingRegion"("name");

-- CreateIndex
CREATE INDEX "OrderStageEvent_orderId_createdAt_idx" ON "OrderStageEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ProblemItem_status_idx" ON "ProblemItem"("status");

-- CreateIndex
CREATE INDEX "ProblemItem_orderId_idx" ON "ProblemItem"("orderId");

-- CreateIndex
CREATE INDEX "Order_shippingRegionId_idx" ON "Order"("shippingRegionId");

-- CreateIndex
CREATE INDEX "Order_stage_idx" ON "Order"("stage");

-- AddForeignKey
ALTER TABLE "OrderStageEvent" ADD CONSTRAINT "OrderStageEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemItem" ADD CONSTRAINT "ProblemItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingRegionId_fkey" FOREIGN KEY ("shippingRegionId") REFERENCES "ShippingRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill local mirrors from the preserved platform status.
UPDATE "Order"
SET "paymentStatus" = UPPER("statusRaw"->>'financialStatus')
WHERE "statusRaw" IS NOT NULL
  AND "statusRaw"->>'financialStatus' IS NOT NULL
  AND "statusRaw"->>'financialStatus' <> '';

-- Existing orders: cancelled -> cancelled, fulfilled -> completed, unpaid
-- unfulfilled -> awaiting_payment, everything else -> review.
UPDATE "Order" SET "stage" = 'cancelled' WHERE "cancelledAt" IS NOT NULL;
UPDATE "Order"
SET "stage" = 'completed'
WHERE "cancelledAt" IS NULL AND "fulfillmentStatus" = 'FULFILLED';
UPDATE "Order"
SET "stage" = 'awaiting_payment'
WHERE "cancelledAt" IS NULL
  AND ("fulfillmentStatus" IS NULL OR "fulfillmentStatus" <> 'FULFILLED')
  AND "source" = 'external'
  AND COALESCE("paymentStatus", '') NOT IN ('PAID', 'PARTIALLY_PAID');
UPDATE "Order"
SET "stage" = 'review'
WHERE "cancelledAt" IS NULL
  AND ("fulfillmentStatus" IS NULL OR "fulfillmentStatus" <> 'FULFILLED')
  AND ("source" = 'manual' OR COALESCE("paymentStatus", '') IN ('PAID', 'PARTIALLY_PAID'));
