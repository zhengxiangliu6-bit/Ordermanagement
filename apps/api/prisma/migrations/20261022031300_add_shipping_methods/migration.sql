-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingMethodId" UUID;

-- CreateTable
CREATE TABLE "ShippingMethod" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingMethod_name_key" ON "ShippingMethod"("name");

-- CreateIndex
CREATE INDEX "Order_shippingMethodId_idx" ON "Order"("shippingMethodId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "ShippingMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
