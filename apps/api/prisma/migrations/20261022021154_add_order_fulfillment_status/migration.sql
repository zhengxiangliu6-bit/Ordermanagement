-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fulfillmentStatus" TEXT;

-- CreateIndex
CREATE INDEX "Order_cancelledAt_fulfillmentStatus_idx" ON "Order"("cancelledAt", "fulfillmentStatus");
