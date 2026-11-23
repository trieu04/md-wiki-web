import { ApiError } from '../../lib/api';
import { messageForError } from '../../lib/error-copy';

export function loginErrorModel(error: unknown) {
  const message = messageForError(error);
  if (!(error instanceof ApiError)) return { message, fields: {} };
  const retryAfter = error.code === 'RATE_LIMITED' ? error.retryAfter : null;
  return {
    message,
    retry:
      retryAfter && /^\d+$/.test(retryAfter)
        ? `Too many attempts. Try again in ${retryAfter} ${retryAfter === '1' ? 'second' : 'seconds'}.`
        : undefined,
    fields:
      error.code === 'VALIDATION_FAILED'
        ? {
            email: error.fields.includes('email') ? 'Enter a valid email address.' : undefined,
            password: error.fields.includes('password') ? 'Enter your password.' : undefined,
          }
        : {},
  };
}
