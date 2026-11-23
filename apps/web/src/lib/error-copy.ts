import type { ErrorCode } from '@md-wiki/domain';
import { ApiError } from './api';

export const errorCopy = {
  VALIDATION_FAILED: 'Check your input and try again.',
  INVALID_PATH: 'This wiki path is not valid.',
  UNAUTHENTICATED: 'Sign in to continue.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  CSRF_INVALID: 'Refresh the page and try again.',
  FORBIDDEN: 'You do not have permission to do this.',
  ACCOUNT_DISABLED: 'This account is disabled.',
  NOT_FOUND: 'We could not find what you requested.',
  ALREADY_EXISTS: 'This already exists.',
  PRECONDITION_FAILED: 'This has changed. Refresh and try again.',
  SELF_REVIEW: 'You cannot review your own suggestion.',
  NOT_ASSIGNED: 'You are not assigned to review this suggestion.',
  DISPUTED: 'Resolve the open dispute or hold before approving.',
  DECISION_BINDING_MISMATCH: 'The preview has changed. Review it again before deciding.',
  DISCUSSION_CHANGED: 'The discussion has changed. Read the latest comments before deciding.',
  SOURCE_CHANGED: 'A source has changed. Check it again before approving.',
  TARGET_BLOCKED: 'This page cannot be published to until an owner resolves the block.',
  ESCALATION_REQUIRED: 'A page author needs to review this suggestion.',
  SECTION_CHANGED: 'This section changed while you were working.',
  STALE_BASE: 'The page changed. Update your suggestion before continuing.',
  EMAIL_TAKEN: 'This email address is already in use.',
  LAST_OWNER: 'At least one owner must be able to sign in.',
  PAYLOAD_TOO_LARGE: 'This is too large to submit.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  STORAGE_ERROR: 'The wiki storage is unavailable.',
  VERIFY_FAILED: 'The change could not be verified.',
  INTERNAL: 'Something went wrong. Try again.',
} satisfies Record<ErrorCode, string>;

export function messageForError(error: unknown) {
  return errorCopy[error instanceof ApiError ? error.code : 'INTERNAL'];
}
