-- OAuth state and encrypted credentials never appear in public Store.settings.
CREATE TABLE "EtsyOAuthPending" (
  "stateHash" TEXT NOT NULL,
  "storeId" UUID NOT NULL,
  "verifierCipher" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EtsyOAuthPending_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "EtsyOAuthPending_storeId_idx" ON "EtsyOAuthPending"("storeId");
CREATE INDEX "EtsyOAuthPending_expiresAt_idx" ON "EtsyOAuthPending"("expiresAt");
ALTER TABLE "EtsyOAuthPending" ADD CONSTRAINT "EtsyOAuthPending_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EtsyCredential" (
  "storeId" UUID NOT NULL,
  "accessTokenCipher" TEXT NOT NULL,
  "refreshTokenCipher" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EtsyCredential_pkey" PRIMARY KEY ("storeId")
);
ALTER TABLE "EtsyCredential" ADD CONSTRAINT "EtsyCredential_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
