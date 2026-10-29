-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_createdBy_fkey";

-- AlterTable
ALTER TABLE "Note" ALTER COLUMN "createdBy" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
