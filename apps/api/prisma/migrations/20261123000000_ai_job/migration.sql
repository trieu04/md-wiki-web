CREATE TYPE "AiJobKind" AS ENUM ('ping');
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TABLE "AiJob" (
    "id" UUID NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);
