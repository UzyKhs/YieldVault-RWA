-- CreateTable
CREATE TABLE "WebhookDeadLetter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT,
    "originalDeliveryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "retriedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'dead-letter'
);

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_endpointId_idx" ON "WebhookDeadLetter"("endpointId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_eventType_idx" ON "WebhookDeadLetter"("eventType");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_createdAt_idx" ON "WebhookDeadLetter"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_status_idx" ON "WebhookDeadLetter"("status");
