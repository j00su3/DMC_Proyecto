import { describe, expect, it } from 'vitest';
import {
  AppError,
  accountInactive,
  accountLocked,
  forbidden,
  invalidCredentials,
  invalidCurrentPassword,
  notFoundEnvelope,
  passwordChangeRequired,
  toErrorEnvelope,
  unauthorized,
} from './errors.js';

describe('toErrorEnvelope', () => {
  it('maps a Fastify schema-validation error to a 400 VALIDATION_ERROR envelope with flattened details', () => {
    const validationError = {
      message: 'body/name must be string',
      validation: [
        {
          keyword: 'invalid_type',
          instancePath: '/name',
          schemaPath: '#/name/invalid_type',
          message: 'Expected string, received number',
          params: {},
        },
      ],
    };

    const result = toErrorEnvelope(validationError);

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details).toEqual(validationError.validation);
  });

  it('maps an AppError to its own status and code', () => {
    const error = new AppError('CONFLICT', 'Resource already exists', 409, {
      field: 'sku',
    });

    const result = toErrorEnvelope(error);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('CONFLICT');
    expect(result.body.error.message).toBe('Resource already exists');
    expect(result.body.error.details).toEqual({ field: 'sku' });
  });

  it('maps an unknown error to a generic 500 INTERNAL_ERROR envelope', () => {
    const result = toErrorEnvelope(
      new Error('database connection reset unexpectedly'),
    );

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(result.body.error.message).toBe('An unexpected error occurred');
    expect(result.body.error).not.toHaveProperty('details');
  });
});

describe('notFoundEnvelope', () => {
  it('produces a 404 NOT_FOUND envelope', () => {
    const result = notFoundEnvelope();

    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
  });
});

describe('auth error factories', () => {
  it('unauthorized() is a 401 AppError with code UNAUTHORIZED', () => {
    const error = unauthorized();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('forbidden() is a 403 AppError with code FORBIDDEN', () => {
    const error = forbidden();

    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('accountLocked() is a 423 AppError carrying details.retryAfter in seconds', () => {
    const error = accountLocked(120);

    expect(error.status).toBe(423);
    expect(error.code).toBe('ACCOUNT_LOCKED');
    expect(error.details).toEqual({ retryAfter: 120 });
  });

  it('invalidCredentials() is a 401 AppError with code INVALID_CREDENTIALS', () => {
    const error = invalidCredentials();

    expect(error.status).toBe(401);
    expect(error.code).toBe('INVALID_CREDENTIALS');
  });

  it('accountInactive() is a 401 AppError with code ACCOUNT_INACTIVE', () => {
    const error = accountInactive();

    expect(error.status).toBe(401);
    expect(error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('passwordChangeRequired() is a 403 AppError with code PASSWORD_CHANGE_REQUIRED', () => {
    const error = passwordChangeRequired();

    expect(error.status).toBe(403);
    expect(error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('invalidCurrentPassword() is a 400 AppError with code INVALID_CURRENT_PASSWORD', () => {
    const error = invalidCurrentPassword();

    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_CURRENT_PASSWORD');
  });
});

describe('toErrorEnvelope — rate limit mapping', () => {
  it('maps a Fastify rate-limit error (statusCode: 429) to a RATE_LIMITED envelope, not INTERNAL_ERROR', () => {
    // Shape actually thrown by @fastify/rate-limit, not a hand-rolled fake:
    // it is a plain Error decorated with statusCode/code, no AppError, no
    // `validation` array.
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
      statusCode: 429,
      code: 'FST_ERR_RATE_LIMIT_EXCEEDED',
    });

    const result = toErrorEnvelope(rateLimitError);

    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe('RATE_LIMITED');
  });
});
