-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "checksumAlgorithm" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "walletAddress" TEXT,
    "rowCount" INTEGER NOT NULL,
    "filters" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ExportJob_createdAt_idx" ON "ExportJob"("createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_checksum_idx" ON "ExportJob"("checksum");

-- CreateIndex
CREATE INDEX "ExportJob_generatedBy_idx" ON "ExportJob"("generatedBy");

-- CreateIndex
CREATE INDEX "ExportJob_walletAddress_idx" ON "ExportJob"("walletAddress");

-- CreateIndex
CREATE INDEX "ExportJob_format_idx" ON "ExportJob"("format");
