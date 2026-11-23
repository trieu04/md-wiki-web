-- Team collections use the same (createdAt, id) ordering as users and tokens.
ALTER TABLE "Team" ADD COLUMN "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Bound the rolling login-failure lookup to this credential/IP bucket and window.
CREATE INDEX "AuditEvent_action_subjectId_at_idx" ON "AuditEvent" ("action", "subjectId", "at");
