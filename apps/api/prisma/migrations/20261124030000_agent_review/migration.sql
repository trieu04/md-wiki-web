-- CreateEnum
CREATE TYPE "ReviewModel" AS ENUM ('self_managed', 'human');

-- CreateEnum
CREATE TYPE "EscalationKind" AS ENUM ('rereview', 'discussion');

-- CreateEnum
CREATE TYPE "EscalationResolution" AS ENUM ('decided', 'withdrawn', 'discussion_closed');

-- CreateEnum
CREATE TYPE "AgentOutcome" AS ENUM ('approved', 'rejected', 'escalated', 'left_pending');

-- CreateEnum
CREATE TYPE "SpotCheckOutcome" AS ENUM ('passed', 'failed');

-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'agent_review';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobTrigger" ADD VALUE 'after_check';
ALTER TYPE "AiJobTrigger" ADD VALUE 'returned';
ALTER TYPE "AiJobTrigger" ADD VALUE 'resumed';

-- CreateTable
CREATE TABLE "ReviewSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "reviewModel" "ReviewModel" NOT NULL DEFAULT 'self_managed',
    "reviewerAgentId" UUID,
    "agentPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMPTZ(3),
    "pausedById" UUID,
    "pauseReason" TEXT,
    "agentEditsHumanPages" BOOLEAN NOT NULL DEFAULT true,
    "customTriggers" JSONB NOT NULL DEFAULT '[]',
    "spotCheckRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "reminderDays" INTEGER NOT NULL DEFAULT 2,
    "autoPublishSeen" BOOLEAN,
    "updatedAt" TIMESTAMPTZ(3),
    "updatedById" UUID,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "kind" "EscalationKind" NOT NULL,
    "triggers" TEXT[],
    "notes" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "assigneeIds" UUID[],
    "topicId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" "EscalationResolution",
    "reminders" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReview" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "outcome" "AgentOutcome" NOT NULL,
    "verdict" TEXT,
    "notes" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "refusals" JSONB NOT NULL,
    "decisionId" UUID,
    "escalationId" UUID,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotCheck" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "reviewerId" UUID NOT NULL,
    "assigneeIds" UUID[],
    "sampledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "SpotCheckOutcome",
    "reason" TEXT,
    "anchors" TEXT[],
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SpotCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishFollowUp" (
    "publicationId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "sampled" BOOLEAN NOT NULL,
    "spotCheckId" UUID,
    "notified" UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishFollowUp_pkey" PRIMARY KEY ("publicationId")
);

-- CreateIndex
CREATE INDEX "Escalation_proposalId_createdAt_idx" ON "Escalation"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "Escalation_resolvedAt_idx" ON "Escalation"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentReview_jobId_key" ON "AgentReview"("jobId");

-- CreateIndex
CREATE INDEX "AgentReview_proposalId_createdAt_idx" ON "AgentReview"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentReview_createdAt_idx" ON "AgentReview"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpotCheck_proposalId_key" ON "SpotCheck"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "SpotCheck_decisionId_key" ON "SpotCheck"("decisionId");

-- CreateIndex
CREATE INDEX "SpotCheck_sampledAt_idx" ON "SpotCheck"("sampledAt");

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotCheck" ADD CONSTRAINT "SpotCheck_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Phase 8 (system-logic §7.8.1) ----------------------------------------------------------------

-- Settings are one row; the owner's values stay within their ranges (D-202).
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_singleton" CHECK ("id" = 1);
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_spot_rate" CHECK ("spotCheckRate" >= 0 AND "spotCheckRate" <= 1);
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_reminder_days" CHECK ("reminderDays" >= 1 AND "reminderDays" <= 30);
INSERT INTO "ReviewSettings" ("id") VALUES (1) ON CONFLICT DO NOTHING;

-- Agent reviews and publication follow-ups are append-only (§4).
CREATE FUNCTION reject_agent_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER "AgentReview_append_only" BEFORE UPDATE OR DELETE ON "AgentReview"
  FOR EACH ROW EXECUTE FUNCTION reject_agent_review_mutation();
CREATE TRIGGER "PublishFollowUp_append_only" BEFORE UPDATE OR DELETE ON "PublishFollowUp"
  FOR EACH ROW EXECUTE FUNCTION reject_agent_review_mutation();

-- A spot check is decided once: only an undecided row may change, and only to decide it (D-214).
CREATE FUNCTION guard_spot_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SpotCheck rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."outcome" IS NOT NULL THEN
    RAISE EXCEPTION 'A decided spot check is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."proposalId" <> OLD."proposalId" OR NEW."decisionId" <> OLD."decisionId"
     OR NEW."publicationId" <> OLD."publicationId" OR NEW."sampledAt" <> OLD."sampledAt" THEN
    RAISE EXCEPTION 'SpotCheck identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SpotCheck_guard" BEFORE UPDATE OR DELETE ON "SpotCheck"
  FOR EACH ROW EXECUTE FUNCTION guard_spot_check();

-- Escalations are state rows (resolution, reminders) but never deleted and keep their identity.
CREATE FUNCTION guard_escalation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Escalation rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."proposalId" <> OLD."proposalId" OR NEW."kind" <> OLD."kind"
     OR NEW."requestedById" <> OLD."requestedById" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."bundleHash" <> OLD."bundleHash" OR NEW."notes" <> OLD."notes"
     OR NEW."triggers" <> OLD."triggers" THEN
    RAISE EXCEPTION 'Escalation identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" THEN
    RAISE EXCEPTION 'A resolved escalation stays resolved' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Escalation_guard" BEFORE UPDATE OR DELETE ON "Escalation"
  FOR EACH ROW EXECUTE FUNCTION guard_escalation();
