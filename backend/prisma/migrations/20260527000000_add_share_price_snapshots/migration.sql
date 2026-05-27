-- CreateTable
CREATE TABLE "SharePriceSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sharePrice" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ledgerSeq" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SharePriceSnapshot_recordedAt_idx" ON "SharePriceSnapshot"("recordedAt");

-- CreateIndex
CREATE INDEX "SharePriceSnapshot_ledgerSeq_idx" ON "SharePriceSnapshot"("ledgerSeq");
