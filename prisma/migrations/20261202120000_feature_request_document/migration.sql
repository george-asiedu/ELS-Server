-- An optional document (PDF or Word) that explains a feature request in detail.
ALTER TABLE "feature_requests" ADD COLUMN "documentUrl" TEXT;
ALTER TABLE "feature_requests" ADD COLUMN "documentName" TEXT;
