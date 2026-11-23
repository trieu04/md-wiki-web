import { expect, it } from 'vitest';
import { loginErrorModel } from '../src/features/login/model';
import { ApiError } from '../src/lib/api';

it('explains rate limiting using numeric Retry-After when present', () => {
  expect(loginErrorModel(new ApiError('RATE_LIMITED', 429, '1')).retry).toBe(
    'Too many attempts. Try again in 1 second.',
  );
  expect(loginErrorModel(new ApiError('RATE_LIMITED', 429, '120')).retry).toBe(
    'Too many attempts. Try again in 120 seconds.',
  );
  expect(loginErrorModel(new ApiError('RATE_LIMITED', 429)).message).toBe(
    'Too many attempts. Try again later.',
  );
});

it('maps only known login fields to approved error presentation', () => {
  expect(
    loginErrorModel(new ApiError('VALIDATION_FAILED', 400, null, null, ['email', 'unknown'])),
  ).toMatchObject({
    message: 'Check your input and try again.',
    fields: { email: 'Enter a valid email address.' },
  });
});
