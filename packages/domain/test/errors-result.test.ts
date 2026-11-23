import { describe, expect, it } from 'vitest';
import { ERROR_STATUS } from '../src/errors.js';
import { err, ok } from '../src/result.js';

const expectedStatus = {
  VALIDATION_FAILED: 400,
  INVALID_PATH: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  CSRF_INVALID: 403,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PRECONDITION_FAILED: 409,
  SELF_REVIEW: 409,
  NOT_ASSIGNED: 409,
  DISPUTED: 409,
  DECISION_BINDING_MISMATCH: 409,
  DISCUSSION_CHANGED: 409,
  SOURCE_CHANGED: 409,
  TARGET_BLOCKED: 409,
  ESCALATION_REQUIRED: 409,
  SECTION_CHANGED: 409,
  STALE_BASE: 409,
  EMAIL_TAKEN: 409,
  LAST_OWNER: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  STORAGE_ERROR: 500,
  VERIFY_FAILED: 500,
  INTERNAL: 500,
} as const;

describe('ERROR_STATUS', () => {
  it('contains exactly the system-logic §9 codes with their HTTP statuses', () => {
    expect(ERROR_STATUS).toEqual(expectedStatus);
    expect(Object.keys(ERROR_STATUS).sort()).toEqual(Object.keys(expectedStatus).sort());
  });
});

describe('Result helpers', () => {
  it('constructs success results', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('constructs error results', () => {
    expect(err('bad')).toEqual({ ok: false, error: 'bad' });
  });
});
