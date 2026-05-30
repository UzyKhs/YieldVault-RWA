-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "WebhookEndpoint" ADD COLUMN "challengeTokenHash" TEXT;
ALTER TABLE "WebhookEndpoint" ADD COLUMN "challengeExpiresAt" DATETIME;
ALTER TABLE "WebhookEndpoint" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "WebhookEndpoint" ADD COLUMN "lastVerificationError" TEXT;

-- CreateIndex
CREATE INDEX "WebhookEndpoint_verificationStatus_idx" ON "WebhookEndpoint"("verificationStatus");
