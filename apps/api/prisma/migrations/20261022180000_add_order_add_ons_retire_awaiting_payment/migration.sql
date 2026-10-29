-- CreateTable
CREATE TABLE "OrderAddOn" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "itemVariantId" UUID,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderAddOn_orderId_idx" ON "OrderAddOn"("orderId");

-- AddForeignKey
ALTER TABLE "OrderAddOn" ADD CONSTRAINT "OrderAddOn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddOn" ADD CONSTRAINT "OrderAddOn_itemVariantId_fkey" FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Payment no longer gates the workflow: every unfulfilled order enters review.
UPDATE "Order" SET "stage" = 'review' WHERE "stage" = 'awaiting_payment';
