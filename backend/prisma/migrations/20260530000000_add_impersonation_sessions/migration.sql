-- CreateTable
CREATE TABLE "AdminImpersonationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "targetWallet" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AdminImpersonationLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminImpersonationLedgerEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AdminImpersonationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AdminImpersonationSession_status_idx" ON "AdminImpersonationSession"("status");

-- CreateIndex
CREATE INDEX "AdminImpersonationSession_actor_idx" ON "AdminImpersonationSession"("actor");

-- CreateIndex
CREATE INDEX "AdminImpersonationSession_targetWallet_idx" ON "AdminImpersonationSession"("targetWallet");

-- CreateIndex
CREATE INDEX "AdminImpersonationSession_startedAt_idx" ON "AdminImpersonationSession"("startedAt");

-- CreateIndex
CREATE INDEX "AdminImpersonationSession_expiresAt_idx" ON "AdminImpersonationSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminImpersonationLedgerEntry_sessionId_idx" ON "AdminImpersonationLedgerEntry"("sessionId");

-- CreateIndex
CREATE INDEX "AdminImpersonationLedgerEntry_eventType_idx" ON "AdminImpersonationLedgerEntry"("eventType");

-- CreateIndex
CREATE INDEX "AdminImpersonationLedgerEntry_createdAt_idx" ON "AdminImpersonationLedgerEntry"("createdAt");
