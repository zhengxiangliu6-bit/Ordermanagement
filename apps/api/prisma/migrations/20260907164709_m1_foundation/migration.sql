-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalShopId" TEXT,
    "externalShopName" TEXT,
    "connectionState" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" JSONB,
    "importStartDate" TIMESTAMP(3),
    "reviewPolicy" JSONB,
    "capabilities" JSONB,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "images" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVariant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "itemId" UUID NOT NULL,
    "itemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "optionValues" JSONB,
    "images" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemContentVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "itemId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storeId" UUID NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "status" TEXT,
    "currentVersionId" UUID,
    "lastSourceUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingVariant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "externalVariantId" TEXT NOT NULL,
    "externalSku" TEXT,
    "optionValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingContentVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "storeId" UUID,
    "platform" TEXT,
    "externalOrderId" TEXT,
    "displayNumber" TEXT NOT NULL,
    "statusRaw" JSONB,
    "fulfillmentRaw" JSONB,
    "customerSnapshot" JSONB,
    "buyerNote" TEXT,
    "giftInfo" JSONB,
    "deliveryMethod" TEXT,
    "financial" JSONB,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "externalLineId" TEXT,
    "quantity" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "personalization" JSONB,
    "listingVariantId" UUID,
    "listingContentVersionId" UUID,
    "itemVariantId" UUID,
    "itemContentVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemOwnerId" UUID,
    "itemVariantOwnerId" UUID,
    "listingOwnerId" UUID,
    "listingVariantOwnerId" UUID,
    "orderOwnerId" UUID,
    "orderLineOwnerId" UUID,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "noteId" UUID NOT NULL,
    "previousBody" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemVariantOwnerId" UUID,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingProvider" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recognition" JSONB,
    "trackingUrlTemplate" TEXT,
    "platformCarrierIds" JSONB,
    "attakyTransform" JSONB,
    "trackingProviderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "carrierId" UUID,
    "originalTrackingNumber" TEXT,
    "attakyTrackingNumber" TEXT,
    "carrierTrackingUrl" TEXT,
    "attakyTrackingUrl" TEXT,
    "trackingProviderId" UUID,
    "publicTrackingMode" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localStatus" TEXT NOT NULL DEFAULT 'prepared',
    "remoteSyncStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "platformResults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipmentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "syncStatus" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storeId" UUID,
    "subjectId" TEXT,
    "payload" JSONB,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Store_platform_idx" ON "Store"("platform");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_archivedAt_idx" ON "Item"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemVariant_itemCode_key" ON "ItemVariant"("itemCode");

-- CreateIndex
CREATE INDEX "ItemVariant_itemId_idx" ON "ItemVariant"("itemId");

-- CreateIndex
CREATE INDEX "ItemContentVersion_itemId_idx" ON "ItemContentVersion"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_currentVersionId_key" ON "Listing"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_storeId_externalListingId_key" ON "Listing"("storeId", "externalListingId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingVariant_listingId_externalVariantId_key" ON "ListingVariant"("listingId", "externalVariantId");

-- CreateIndex
CREATE INDEX "ListingContentVersion_listingId_idx" ON "ListingContentVersion"("listingId");

-- CreateIndex
CREATE INDEX "Order_displayNumber_idx" ON "Order"("displayNumber");

-- CreateIndex
CREATE INDEX "Order_archivedAt_deletedAt_idx" ON "Order"("archivedAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_externalOrderId_key" ON "Order"("storeId", "externalOrderId");

-- CreateIndex
CREATE INDEX "OrderLine_listingVariantId_idx" ON "OrderLine"("listingVariantId");

-- CreateIndex
CREATE INDEX "OrderLine_itemVariantId_idx" ON "OrderLine"("itemVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_externalLineId_key" ON "OrderLine"("orderId", "externalLineId");

-- CreateIndex
CREATE INDEX "OrderRevision_orderId_idx" ON "OrderRevision"("orderId");

-- CreateIndex
CREATE INDEX "Note_ownerType_ownerId_idx" ON "Note"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "NoteRevision_noteId_idx" ON "NoteRevision"("noteId");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_idx" ON "AuditEvent"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorType_actorId_idx" ON "AuditEvent"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingProvider_key_key" ON "TrackingProvider"("key");

-- CreateIndex
CREATE INDEX "Carrier_enabled_idx" ON "Carrier"("enabled");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_remoteSyncStatus_idx" ON "Shipment"("remoteSyncStatus");

-- CreateIndex
CREATE INDEX "ShipmentRevision_shipmentId_idx" ON "ShipmentRevision"("shipmentId");

-- CreateIndex
CREATE INDEX "ReviewRecord_type_status_idx" ON "ReviewRecord"("type", "status");

-- CreateIndex
CREATE INDEX "ReviewRecord_storeId_status_idx" ON "ReviewRecord"("storeId", "status");

-- AddForeignKey
ALTER TABLE "ItemVariant" ADD CONSTRAINT "ItemVariant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemContentVersion" ADD CONSTRAINT "ItemContentVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ListingContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingContentVersion" ADD CONSTRAINT "ListingContentVersion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "ListingVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_listingContentVersionId_fkey" FOREIGN KEY ("listingContentVersionId") REFERENCES "ListingContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemVariantId_fkey" FOREIGN KEY ("itemVariantId") REFERENCES "ItemVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_itemContentVersionId_fkey" FOREIGN KEY ("itemContentVersionId") REFERENCES "ItemContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_itemOwnerId_fkey" FOREIGN KEY ("itemOwnerId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_itemVariantOwnerId_fkey" FOREIGN KEY ("itemVariantOwnerId") REFERENCES "ItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_listingOwnerId_fkey" FOREIGN KEY ("listingOwnerId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_listingVariantOwnerId_fkey" FOREIGN KEY ("listingVariantOwnerId") REFERENCES "ListingVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_orderOwnerId_fkey" FOREIGN KEY ("orderOwnerId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_orderLineOwnerId_fkey" FOREIGN KEY ("orderLineOwnerId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_itemVariantOwnerId_fkey" FOREIGN KEY ("itemVariantOwnerId") REFERENCES "ItemVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_trackingProviderId_fkey" FOREIGN KEY ("trackingProviderId") REFERENCES "TrackingProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRevision" ADD CONSTRAINT "ShipmentRevision_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

