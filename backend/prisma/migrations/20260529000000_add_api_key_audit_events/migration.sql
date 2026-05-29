-- CreateTable
CREATE TABLE "ApiKeyAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ApiKeyAuditEvent_action_idx" ON "ApiKeyAuditEvent"("action");

-- CreateIndex
CREATE INDEX "ApiKeyAuditEvent_createdAt_idx" ON "ApiKeyAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ApiKeyAuditEvent_keyFingerprint_idx" ON "ApiKeyAuditEvent"("keyFingerprint");
