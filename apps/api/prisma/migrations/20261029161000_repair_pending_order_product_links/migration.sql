-- Repair missing links only for orders that have not deducted stock.
-- Existing identities and completed shipment history are never guessed from titles.
UPDATE "OrderLine" AS line
SET "itemVariantId" = listing."itemVariantId", "updatedAt" = CURRENT_TIMESTAMP
FROM "ListingVariant" AS listing, "Order" AS orders, "ItemVariant" AS variant, "Item" AS item
WHERE line."listingVariantId" = listing."id"
  AND line."itemVariantId" IS NULL AND listing."itemVariantId" IS NOT NULL
  AND variant."id" = listing."itemVariantId" AND item."id" = variant."itemId"
  AND variant."archivedAt" IS NULL AND item."archivedAt" IS NULL
  AND orders."id" = line."orderId" AND orders."stage" IN ('review', 'packing')
  AND orders."stockDeductedAt" IS NULL;

UPDATE "OrderLine" AS line
SET "itemContentVersionId" = (
  SELECT version."id" FROM "ItemContentVersion" AS version
  JOIN "ItemVariant" AS variant ON variant."itemId" = version."itemId"
  WHERE variant."id" = line."itemVariantId"
  ORDER BY (version."effectiveAt" <= line."createdAt") DESC, version."effectiveAt" DESC
  LIMIT 1
), "updatedAt" = CURRENT_TIMESTAMP
FROM "Order" AS orders
WHERE orders."id" = line."orderId" AND orders."stage" IN ('review', 'packing')
  AND orders."stockDeductedAt" IS NULL AND line."itemVariantId" IS NOT NULL
  AND line."itemContentVersionId" IS NULL;

-- Infer only uniform managed categories. Mixed or unclassified orders remain for review.
UPDATE "Order" AS orders SET "categoryId" = inferred."categoryId", "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT line."orderId", min(item."categoryId"::text)::uuid AS "categoryId"
  FROM "OrderLine" AS line
  LEFT JOIN "ItemVariant" AS variant ON variant."id" = line."itemVariantId"
  LEFT JOIN "Item" AS item ON item."id" = variant."itemId"
  GROUP BY line."orderId"
  HAVING count(*) = count(item."categoryId") AND count(DISTINCT item."categoryId") = 1
) AS inferred
WHERE orders."id" = inferred."orderId" AND orders."categoryId" IS NULL
  AND orders."stage" IN ('review', 'packing') AND orders."stockDeductedAt" IS NULL;
