-- CreateIndex
CREATE INDEX "Note_createdBy_idx" ON "Note"("createdBy");

-- CreateIndex
CREATE INDEX "Note_updatedBy_idx" ON "Note"("updatedBy");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

