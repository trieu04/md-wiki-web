-- Phase 9b credibility jobs (system-logic §7.7.12, D-230..D-233)
ALTER TYPE "AiJobKind" ADD VALUE 'retraction_check';
ALTER TYPE "AiJobKind" ADD VALUE 'copy_candidates';
ALTER TYPE "AiJobKind" ADD VALUE 'relation_candidates';
ALTER TYPE "AiJobKind" ADD VALUE 'credibility_score';

ALTER TYPE "AiJobTrigger" ADD VALUE 'manual';
ALTER TYPE "AiJobTrigger" ADD VALUE 'weekly';
ALTER TYPE "AiJobTrigger" ADD VALUE 'daily';
ALTER TYPE "AiJobTrigger" ADD VALUE 'internal';

ALTER TABLE "AiJob" ADD COLUMN "appliedAt" TIMESTAMPTZ(3);

CREATE TABLE "SectionScore" (
    "path" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "sectionHash" TEXT NOT NULL,
    "p" DOUBLE PRECISION NOT NULL,
    "lower10" DOUBLE PRECISION NOT NULL,
    "u" DOUBLE PRECISION NOT NULL,
    "r" DOUBLE PRECISION NOT NULL,
    "s" DOUBLE PRECISION NOT NULL,
    "flagged" BOOLEAN NOT NULL,
    "reach" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "paramsSha256" TEXT NOT NULL,
    "jobId" UUID NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SectionScore_pkey" PRIMARY KEY ("path","anchor","sectionHash")
);

CREATE INDEX "SectionScore_computedAt_idx" ON "SectionScore"("computedAt");
