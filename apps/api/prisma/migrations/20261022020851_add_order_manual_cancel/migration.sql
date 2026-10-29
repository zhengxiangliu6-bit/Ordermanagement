-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "cancelledReason" TEXT;
