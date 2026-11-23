-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('open', 'on_hold', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('open', 'comment', 'agreement', 'close', 'reopen');

-- CreateEnum
CREATE TYPE "DisputeAction" AS ENUM ('open', 'comment', 'resolve', 'reopen');

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "anchor" TEXT,
    "versionLabel" TEXT,
    "title" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'open',
    "proposalId" UUID,
    "bundleHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "participantIds" UUID[],
    "closedById" UUID,
    "closeReason" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionEvent" (
    "id" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "parentSeq" INTEGER,
    "agreesWith" INTEGER,
    "outcome" "TopicStatus",
    "mentions" UUID[],
    "bundleHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvent" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "action" "DisputeAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "resolutionKind" TEXT,
    "relatedSlugs" TEXT[],
    "bundleHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_proposalId_key" ON "Topic"("proposalId");

-- CreateIndex
CREATE INDEX "Topic_path_anchor_idx" ON "Topic"("path", "anchor");

-- CreateIndex
CREATE INDEX "Topic_status_updatedAt_idx" ON "Topic"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Topic_updatedAt_id_idx" ON "Topic"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionEvent_topicId_seq_key" ON "DiscussionEvent"("topicId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeEvent_proposalId_seq_key" ON "DisputeEvent"("proposalId", "seq");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionEvent" ADD CONSTRAINT "DiscussionEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionEvent" ADD CONSTRAINT "DiscussionEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvent" ADD CONSTRAINT "DisputeEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvent" ADD CONSTRAINT "DisputeEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Discussion entries and the dispute log are append-only (§4, §7.5.1).
CREATE FUNCTION reject_discussion_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER discussion_event_append_only BEFORE UPDATE OR DELETE ON "DiscussionEvent"
FOR EACH ROW EXECUTE FUNCTION reject_discussion_record_mutation();
CREATE TRIGGER dispute_event_append_only BEFORE UPDATE OR DELETE ON "DisputeEvent"
FOR EACH ROW EXECUTE FUNCTION reject_discussion_record_mutation();

-- Topic is a state row: its identity is frozen, it is never deleted, and its version only grows
-- (each change appends a DiscussionEvent with seq = the new version in the same transaction).
CREATE FUNCTION guard_topic_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Topic rows are never deleted';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."path" <> OLD."path"
       OR NEW."anchor" IS DISTINCT FROM OLD."anchor"
       OR NEW."versionLabel" IS DISTINCT FROM OLD."versionLabel"
       OR NEW."authorId" <> OLD."authorId"
       OR NEW."proposalId" IS DISTINCT FROM OLD."proposalId"
       OR NEW."bundleHash" IS DISTINCT FROM OLD."bundleHash"
       OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'Topic identity columns are frozen';
    END IF;
    IF NEW."version" < OLD."version" THEN
        RAISE EXCEPTION 'Topic version never decreases';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER topic_guard BEFORE UPDATE OR DELETE ON "Topic"
FOR EACH ROW EXECUTE FUNCTION guard_topic_mutation();

ALTER TABLE "Topic" ADD CONSTRAINT "Topic_version_positive" CHECK ("version" >= 1);
ALTER TABLE "DiscussionEvent" ADD CONSTRAINT "DiscussionEvent_seq_positive" CHECK ("seq" >= 1);
ALTER TABLE "DisputeEvent" ADD CONSTRAINT "DisputeEvent_seq_positive" CHECK ("seq" >= 1);
