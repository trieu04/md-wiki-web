-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('pending', 'approved', 'published', 'rejected', 'stale');

-- CreateEnum
CREATE TYPE "ProposalOrigin" AS ENUM ('editor', 'api', 'import');

-- CreateEnum
CREATE TYPE "ProposalRefRole" AS ENUM ('target', 'scope', 'source');

-- CreateTable
CREATE TABLE "Draft" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "targetPath" TEXT NOT NULL,
    "baseSnapshotId" UUID,
    "scope" JSONB NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "sources" JSONB NOT NULL,
    "appliesTo" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "section" TEXT,
    "submitterId" UUID NOT NULL,
    "origin" "ProposalOrigin" NOT NULL,
    "state" "ProposalState" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "manifest" BYTEA NOT NULL,
    "base" BYTEA,
    "proposed" BYTEA NOT NULL,
    "artifact" BYTEA,
    "artifactHash" TEXT,
    "baseSha256" TEXT,
    "baseSnapshotId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalRef" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "role" "ProposalRefRole" NOT NULL,
    "impact" TEXT,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "ProposalRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Draft_authorId_updatedAt_idx" ON "Draft"("authorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_authorId_targetPath_key" ON "Draft"("authorId", "targetPath");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_slug_key" ON "Proposal"("slug");

-- CreateIndex
CREATE INDEX "Proposal_submitterId_createdAt_idx" ON "Proposal"("submitterId", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_targetPath_state_idx" ON "Proposal"("targetPath", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRef_proposalId_role_snapshotId_key" ON "ProposalRef"("proposalId", "role", "snapshotId");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_baseSnapshotId_fkey" FOREIGN KEY ("baseSnapshotId") REFERENCES "Snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_baseSnapshotId_fkey" FOREIGN KEY ("baseSnapshotId") REFERENCES "Snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRef" ADD CONSTRAINT "ProposalRef_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRef" ADD CONSTRAINT "ProposalRef_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Frozen proposals (system-logic §7.2.1, D-57): the bundle and its identity never change;
-- only state, artifact and updatedAt move later. Proposals and their refs are never deleted.
CREATE FUNCTION reject_frozen_proposal_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Proposal rows are never deleted';
    END IF;
    IF NEW."slug" IS DISTINCT FROM OLD."slug"
        OR NEW."targetPath" IS DISTINCT FROM OLD."targetPath"
        OR NEW."submitterId" IS DISTINCT FROM OLD."submitterId"
        OR NEW."origin" IS DISTINCT FROM OLD."origin"
        OR NEW."bundleHash" IS DISTINCT FROM OLD."bundleHash"
        OR NEW."manifest" IS DISTINCT FROM OLD."manifest"
        OR NEW."base" IS DISTINCT FROM OLD."base"
        OR NEW."proposed" IS DISTINCT FROM OLD."proposed"
        OR NEW."baseSha256" IS DISTINCT FROM OLD."baseSha256"
        OR NEW."baseSnapshotId" IS DISTINCT FROM OLD."baseSnapshotId"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'Proposal bundle columns are frozen';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER proposal_frozen BEFORE UPDATE OR DELETE ON "Proposal"
FOR EACH ROW EXECUTE FUNCTION reject_frozen_proposal_change();

CREATE FUNCTION reject_proposal_ref_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ProposalRef is append-only';
END;
$$;

CREATE TRIGGER proposal_ref_append_only BEFORE UPDATE OR DELETE ON "ProposalRef"
FOR EACH ROW EXECUTE FUNCTION reject_proposal_ref_mutation();

