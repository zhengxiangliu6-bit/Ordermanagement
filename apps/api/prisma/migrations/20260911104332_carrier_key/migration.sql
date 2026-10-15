-- AlterTable
ALTER TABLE "Carrier" ADD COLUMN     "key" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_key_key" ON "Carrier"("key");

