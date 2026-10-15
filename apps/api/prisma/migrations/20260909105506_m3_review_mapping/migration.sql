-- AlterTable
ALTER TABLE "ListingVariant" ADD COLUMN     "itemVariantId" UUID;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "lastAcceptedExternal" JSONB;

-- AlterTable
ALTER TABLE "ReviewRecord" ADD COLUMN     "payloadHash" TEXT;

-- CreateIndex
CREATE INDEX "ListingVariant_itemVariantId_idx" ON "ListingVariant"("itemVariantId");

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_itemVariantId_fkey" FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

