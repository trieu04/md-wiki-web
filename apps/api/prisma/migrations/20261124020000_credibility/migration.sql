-- CreateEnum
CREATE TYPE "SourceCheckResult" AS ENUM ('supported', 'not_supported', 'unverifiable');

-- CreateEnum
CREATE TYPE "AttestationKind" AS ENUM ('useful', 'checked', 'used', 'report');

-- CreateEnum
CREATE TYPE "AttestationStatus" AS ENUM ('withdrawn', 'confirmed', 'confirmed_error', 'dismissed', 'fixed', 'downweighted');

-- CreateEnum
CREATE TYPE "InvalidationKind" AS ENUM ('retraction', 'concern', 'source_changed', 'version_changed', 'contradiction', 'root_wrong');

-- CreateEnum
CREATE TYPE "ErrorOrigin" AS ENUM ('report', 'source_check', 'flag', 'spot_check', 'manual');

-- CreateEnum
CREATE TYPE "FlagCause" AS ENUM ('report', 'retraction', 'source_changed', 'version_changed', 'contradiction', 'root_wrong', 'propagated');

-- CreateEnum
CREATE TYPE "EdgeKind" AS ENUM ('copy', 'corroborates', 'contradicts', 'lab_data');

-- CreateEnum
CREATE TYPE "FollowReason" AS ENUM ('manual', 'attested', 'contributed');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'email_daily', 'off');

-- CreateEnum
CREATE TYPE "FeedbackAnswer" AS ENUM ('yes', 'partly', 'no');

-- CreateTable
CREATE TABLE "SourceCheck" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceTitle" TEXT,
    "sourceSnapshotId" UUID,
    "result" "SourceCheckResult" NOT NULL,
    "excerpt" TEXT,
    "location" TEXT,
    "comparedNumbers" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "checkerId" UUID NOT NULL,
    "checkerKind" "ReviewerKind" NOT NULL,
    "proposalId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerConfirmation" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvalidationEvent" (
    "id" UUID NOT NULL,
    "kind" "InvalidationKind" NOT NULL,
    "ref" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID,
    "jobId" UUID,

    CONSTRAINT "InvalidationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmedError" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "origin" "ErrorOrigin" NOT NULL,
    "originId" UUID,
    "confirmedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmedError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecheckFlag" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "cause" "FlagCause" NOT NULL,
    "causeId" UUID,
    "reason" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecheckFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilityResolution" (
    "id" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "path" TEXT,
    "anchor" TEXT,
    "sectionHash" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredibilityResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "teamId" UUID,
    "role" "Role" NOT NULL,
    "kind" "AttestationKind" NOT NULL,
    "details" JSONB NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "sawCounts" BOOLEAN NOT NULL,
    "topicId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttestationEvent" (
    "id" UUID NOT NULL,
    "attestationId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorId" UUID,
    "status" "AttestationStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttestationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageFeedback" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "teamId" UUID,
    "answer" "FeedbackAnswer" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilityAggregate" (
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "teamKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredibilityAggregate_pkey" PRIMARY KEY ("path","anchor","sectionHash","versionLabel","metric","teamKey")
);

-- CreateTable
CREATE TABLE "EdgeCandidate" (
    "id" UUID NOT NULL,
    "kind" "EdgeKind" NOT NULL,
    "srcPath" TEXT NOT NULL,
    "srcAnchor" TEXT NOT NULL,
    "dstPath" TEXT NOT NULL,
    "dstAnchor" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "jobId" UUID,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdgeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilityEdge" (
    "id" UUID NOT NULL,
    "kind" "EdgeKind" NOT NULL,
    "srcPath" TEXT NOT NULL,
    "srcAnchor" TEXT NOT NULL,
    "dstPath" TEXT NOT NULL,
    "dstAnchor" TEXT NOT NULL,
    "candidateId" UUID,
    "confirmedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredibilityEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnchorLink" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "oldAnchor" TEXT NOT NULL,
    "oldHash" TEXT NOT NULL,
    "newAnchor" TEXT NOT NULL,
    "newHash" TEXT NOT NULL,
    "proposalId" UUID,
    "reviewerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnchorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "userId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL DEFAULT '',
    "reason" "FollowReason" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mutedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("userId","path","anchor")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "userId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("userId","event")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "path" TEXT,
    "anchor" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),
    "emailedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredibilityGate" (
    "capability" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "runRecord" TEXT,
    "runDate" TEXT,
    "actorId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredibilityGate_pkey" PRIMARY KEY ("capability")
);

-- CreateIndex
CREATE INDEX "SourceCheck_path_anchor_sectionHash_idx" ON "SourceCheck"("path", "anchor", "sectionHash");

-- CreateIndex
CREATE INDEX "SourceCheck_sourceRef_idx" ON "SourceCheck"("sourceRef");

-- CreateIndex
CREATE INDEX "OwnerConfirmation_path_anchor_sectionHash_idx" ON "OwnerConfirmation"("path", "anchor", "sectionHash");

-- CreateIndex
CREATE INDEX "InvalidationEvent_ref_idx" ON "InvalidationEvent"("ref");

-- CreateIndex
CREATE INDEX "ConfirmedError_path_anchor_sectionHash_idx" ON "ConfirmedError"("path", "anchor", "sectionHash");

-- CreateIndex
CREATE INDEX "RecheckFlag_path_anchor_sectionHash_idx" ON "RecheckFlag"("path", "anchor", "sectionHash");

-- CreateIndex
CREATE INDEX "RecheckFlag_causeId_idx" ON "RecheckFlag"("causeId");

-- CreateIndex
CREATE INDEX "CredibilityResolution_subjectId_idx" ON "CredibilityResolution"("subjectId");

-- CreateIndex
CREATE INDEX "Attestation_path_anchor_sectionHash_idx" ON "Attestation"("path", "anchor", "sectionHash");

-- CreateIndex
CREATE INDEX "Attestation_actorId_createdAt_idx" ON "Attestation"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttestationEvent_attestationId_seq_key" ON "AttestationEvent"("attestationId", "seq");

-- CreateIndex
CREATE INDEX "PageFeedback_path_versionLabel_idx" ON "PageFeedback"("path", "versionLabel");

-- CreateIndex
CREATE INDEX "CredibilityEdge_srcPath_srcAnchor_idx" ON "CredibilityEdge"("srcPath", "srcAnchor");

-- CreateIndex
CREATE INDEX "CredibilityEdge_dstPath_dstAnchor_idx" ON "CredibilityEdge"("dstPath", "dstAnchor");

-- CreateIndex
CREATE UNIQUE INDEX "AnchorLink_path_newAnchor_newHash_oldAnchor_oldHash_key" ON "AnchorLink"("path", "newAnchor", "newHash", "oldAnchor", "oldHash");

-- CreateIndex
CREATE INDEX "Follow_path_idx" ON "Follow"("path");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");


-- Credibility records are append-only (system-logic §4, §7.7.1).
CREATE FUNCTION reject_credibility_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['SourceCheck', 'OwnerConfirmation', 'InvalidationEvent', 'ConfirmedError',
        'RecheckFlag', 'CredibilityResolution', 'EdgeCandidate', 'CredibilityEdge', 'AnchorLink']
    LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_credibility_record_mutation()',
            lower(t) || '_append_only', t);
    END LOOP;
END;
$$;

-- Reader records are append-only too, except that the retention purge (D-169) may delete raw rows
-- inside a transaction that set `SET LOCAL md_wiki.purge = 'on'`.
CREATE FUNCTION guard_reader_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('md_wiki.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER attestation_append_only BEFORE UPDATE OR DELETE ON "Attestation"
FOR EACH ROW EXECUTE FUNCTION guard_reader_record_mutation();
CREATE TRIGGER attestation_event_append_only BEFORE UPDATE OR DELETE ON "AttestationEvent"
FOR EACH ROW EXECUTE FUNCTION guard_reader_record_mutation();
CREATE TRIGGER page_feedback_append_only BEFORE UPDATE OR DELETE ON "PageFeedback"
FOR EACH ROW EXECUTE FUNCTION guard_reader_record_mutation();

ALTER TABLE "AttestationEvent" ADD CONSTRAINT "AttestationEvent_seq_positive" CHECK ("seq" >= 1);
ALTER TABLE "RecheckFlag" ADD CONSTRAINT "RecheckFlag_depth_nonnegative" CHECK ("depth" >= 0);
ALTER TABLE "CredibilityAggregate" ADD CONSTRAINT "CredibilityAggregate_count_nonnegative" CHECK ("count" >= 0);
ALTER TABLE "EdgeCandidate" ADD CONSTRAINT "EdgeCandidate_score_range" CHECK ("score" >= 0 AND "score" <= 1);
