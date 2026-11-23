-- CreateEnum
CREATE TYPE "AiJobTrigger" AS ENUM ('dev', 'submit', 'rerun', 'self_check');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('info', 'warning', 'blocking');

-- CreateEnum
CREATE TYPE "FindingOrigin" AS ENUM ('model', 'rule');

-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'quality_check';

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "bundleHash" TEXT,
ADD COLUMN     "draftId" UUID,
ADD COLUMN     "dropped" JSONB,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "proposalId" UUID,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "requestedById" UUID,
ADD COLUMN     "rulesSha256" TEXT,
ADD COLUMN     "tokensIn" INTEGER,
ADD COLUMN     "tokensOut" INTEGER,
ADD COLUMN     "trigger" "AiJobTrigger" NOT NULL DEFAULT 'dev';

-- CreateTable
CREATE TABLE "Finding" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "proposalId" UUID,
    "draftId" UUID,
    "ord" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "origin" "FindingOrigin" NOT NULL,
    "original" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Finding_proposalId_idx" ON "Finding"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_jobId_ord_key" ON "Finding"("jobId", "ord");

-- CreateIndex
CREATE INDEX "AiJob_proposalId_createdAt_idx" ON "AiJob"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_draftId_createdAt_idx" ON "AiJob"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_kind_createdAt_idx" ON "AiJob"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_status_createdAt_idx" ON "AiJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Findings are append-only (§4, §7.6.1): a job's findings are inserted once, with the result.
CREATE FUNCTION reject_finding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER finding_append_only BEFORE UPDATE OR DELETE ON "Finding"
FOR EACH ROW EXECUTE FUNCTION reject_finding_mutation();
