-- CreateTable
CREATE TABLE "AdminActionReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputHash" TEXT NOT NULL,
    "resultingState" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdminActionReceipt_action_idx" ON "AdminActionReceipt"("action");

-- CreateIndex
CREATE INDEX "AdminActionReceipt_actor_idx" ON "AdminActionReceipt"("actor");

-- CreateIndex
CREATE INDEX "AdminActionReceipt_timestamp_idx" ON "AdminActionReceipt"("timestamp");
