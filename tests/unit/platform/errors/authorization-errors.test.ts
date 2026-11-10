import { describe, expect, it } from 'vitest';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
} from '@/platform/errors';
import { mapErrorToRest } from '@/platform/Http/map-error';

describe('AppError subclasses', () => {
  it('preserve their concrete prototype', () => {
    expect(new AuthenticationError()).toBeInstanceOf(AuthenticationError);
    expect(new AuthorizationError()).toBeInstanceOf(AuthorizationError);
    expect(new ValidationError('invalid')).toBeInstanceOf(ValidationError);
    expect(new NotFoundError('missing')).toBeInstanceOf(NotFoundError);
    expect(new ConflictError('conflict')).toBeInstanceOf(ConflictError);
    expect(new RateLimitError('slow down')).toBeInstanceOf(RateLimitError);
  });

  it('remain instances of AppError', () => {
    expect(new AuthenticationError()).toBeInstanceOf(AppError);
    expect(new AuthorizationError()).toBeInstanceOf(AppError);
  });

  it('expose stable error codes', () => {
    expect(new AuthenticationError().code).toBe('authentication_required');
    expect(new AuthorizationError().code).toBe('forbidden');
  });
});

describe('mapErrorToRest authorization mapping', () => {
  it('maps authentication failures to 401', () => {
    const mapped = mapErrorToRest(new AuthenticationError(), 'req-1');

    expect(mapped.status).toBe(401);
    expect(mapped.body).toMatchObject({
      error: { code: 'authentication_required', requestId: 'req-1' },
    });
  });

  it('maps authorization failures to 403', () => {
    const mapped = mapErrorToRest(new AuthorizationError(), 'req-2');

    expect(mapped.status).toBe(403);
    expect(mapped.body).toMatchObject({ error: { code: 'forbidden', requestId: 'req-2' } });
  });
});
