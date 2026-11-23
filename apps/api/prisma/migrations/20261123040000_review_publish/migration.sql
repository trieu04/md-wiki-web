-- CreateEnum
CREATE TYPE "PublicationPhase" AS ENUM ('prepared', 'writing', 'written', 'done', 'unknown', 'stale', 'not_written');

-- CreateEnum
CREATE TYPE "ResolutionOutcome" AS ENUM ('written', 'not_written');

-- CreateEnum
CREATE TYPE "ConflictOutcome" AS ENUM ('keep_current', 'use_incoming', 'merge');

-- CreateEnum
CREATE TYPE "ReviewerKind" AS ENUM ('agent', 'person');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('approval', 'retry');

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "reviewerKind" "ReviewerKind" NOT NULL,
    "approve" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "artifactHash" TEXT NOT NULL,
    "previewAt" TIMESTAMPTZ(3) NOT NULL,
    "discussionVersion" INTEGER NOT NULL,
    "disputeVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "targetPath" TEXT NOT NULL,
    "decisionId" UUID NOT NULL,
    "phase" "PublicationPhase" NOT NULL,
    "auto" BOOLEAN NOT NULL,
    "actorId" UUID,
    "baseSha256" TEXT,
    "artifactHash" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "receipt" JSONB,
    "error" TEXT,
    "versionLabel" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "writtenAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resolution" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "outcome" "ResolutionOutcome" NOT NULL,
    "evidence" TEXT NOT NULL,
    "diskSha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictResolution" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "outcome" "ConflictOutcome" NOT NULL,
    "baseSha256" TEXT,
    "currentSha256" TEXT,
    "replacementId" UUID,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishOutbox" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PublishOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedSection" (
    "publicationId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "reviewerKind" "ReviewerKind" NOT NULL,
    "reviewedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PublishedSection_pkey" PRIMARY KEY ("publicationId","anchor")
);

-- CreateIndex
CREATE INDEX "Assignment_proposalId_idx" ON "Assignment"("proposalId");

-- CreateIndex
CREATE INDEX "Assignment_assigneeId_closedAt_idx" ON "Assignment"("assigneeId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_proposalId_key" ON "Decision"("proposalId");

-- CreateIndex
CREATE INDEX "Publication_targetPath_phase_idx" ON "Publication"("targetPath", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_proposalId_attempt_key" ON "Publication"("proposalId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "Resolution_publicationId_key" ON "Resolution"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictResolution_proposalId_key" ON "ConflictResolution"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_proposalId_key" ON "Withdrawal"("proposalId");

-- CreateIndex
CREATE INDEX "PublishOutbox_processedAt_idx" ON "PublishOutbox"("processedAt");

-- CreateIndex
CREATE INDEX "PublishedSection_path_anchor_sectionHash_idx" ON "PublishedSection"("path", "anchor", "sectionHash");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictResolution" ADD CONSTRAINT "ConflictResolution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictResolution" ADD CONSTRAINT "ConflictResolution_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictResolution" ADD CONSTRAINT "ConflictResolution_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishOutbox" ADD CONSTRAINT "PublishOutbox_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishOutbox" ADD CONSTRAINT "PublishOutbox_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedSection" ADD CONSTRAINT "PublishedSection_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One open publication per target page and per proposal (system-logic §7.4.1, D-78):
-- a target in an open or unknown phase is held; nothing else may start writing it.
CREATE UNIQUE INDEX "Publication_open_target_key" ON "Publication"("targetPath")
    WHERE "phase" IN ('prepared', 'writing', 'written', 'unknown');
CREATE UNIQUE INDEX "Publication_open_proposal_key" ON "Publication"("proposalId")
    WHERE "phase" IN ('prepared', 'writing', 'written', 'unknown');

-- One open assignment per (proposal, assignee); one pending outbox row per proposal (§8.1).
CREATE UNIQUE INDEX "Assignment_open_key" ON "Assignment"("proposalId", "assigneeId")
    WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "PublishOutbox_pending_key" ON "PublishOutbox"("proposalId")
    WHERE "processedAt" IS NULL;

-- Records of what was decided, resolved and published are append-only (§4).
CREATE FUNCTION reject_review_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER decision_append_only BEFORE UPDATE OR DELETE ON "Decision"
FOR EACH ROW EXECUTE FUNCTION reject_review_record_mutation();
CREATE TRIGGER resolution_append_only BEFORE UPDATE OR DELETE ON "Resolution"
FOR EACH ROW EXECUTE FUNCTION reject_review_record_mutation();
CREATE TRIGGER conflict_resolution_append_only BEFORE UPDATE OR DELETE ON "ConflictResolution"
FOR EACH ROW EXECUTE FUNCTION reject_review_record_mutation();
CREATE TRIGGER withdrawal_append_only BEFORE UPDATE OR DELETE ON "Withdrawal"
FOR EACH ROW EXECUTE FUNCTION reject_review_record_mutation();
CREATE TRIGGER published_section_append_only BEFORE UPDATE OR DELETE ON "PublishedSection"
FOR EACH ROW EXECUTE FUNCTION reject_review_record_mutation();

-- Backfill (§7.4.2): pending proposals submitted before Phase 5 get the owner assignee by the
-- same rule as new ones (oldest enabled human owner who is not the submitter).
INSERT INTO "Assignment" ("id", "proposalId", "assigneeId", "reason", "createdAt")
SELECT gen_random_uuid(), p."id", o."id", 'owner', CURRENT_TIMESTAMP
FROM "Proposal" p
CROSS JOIN LATERAL (
    SELECT u."id" FROM "User" u
    WHERE u."kind" = 'human' AND u."disabledAt" IS NULL AND 'owner' = ANY (u."roles")
      AND u."id" <> p."submitterId"
    ORDER BY u."createdAt", u."id"
    LIMIT 1
) o
WHERE p."state" = 'pending';
