-- CreateTable
CREATE TABLE "OrderLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "relatedOrderId" UUID NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLink_relatedOrderId_idx" ON "OrderLink"("relatedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLink_orderId_relatedOrderId_key" ON "OrderLink"("orderId", "relatedOrderId");

-- AddForeignKey
ALTER TABLE "OrderLink" ADD CONSTRAINT "OrderLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLink" ADD CONSTRAINT "OrderLink_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

