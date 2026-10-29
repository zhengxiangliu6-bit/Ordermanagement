-- Gifts are display lines only; the packed box weight is entered once.
ALTER TABLE "OrderAddOn"
  DROP COLUMN IF EXISTS "heightCm",
  DROP COLUMN IF EXISTS "lengthCm",
  DROP COLUMN IF EXISTS "weightGrams",
  DROP COLUMN IF EXISTS "widthCm";
