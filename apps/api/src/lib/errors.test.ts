import { describe, expect, it } from 'vitest';
import {
  AppError,
  accountInactive,
  accountLocked,
  auditWriteFailed,
  emailAlreadyInUse,
  fieldReservedForEncargado,
  forbidden,
  invalidCredentials,
  invalidCurrentPassword,
  lastActiveEncargado,
  notFoundEnvelope,
  passwordChangeRequired,
  productNotFound,
  skuAlreadyInUse,
  supplierInactive,
  supplierNameInUse,
  supplierNotFound,
  toErrorEnvelope,
  unauthorized,
  userNotFound,
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

  it('auditWriteFailed() is a 500 AppError with code AUDIT_WRITE_FAILED, preserving cause', () => {
    const cause = new Error('insert violates check constraint');

    const error = auditWriteFailed(cause);

    expect(error.status).toBe(500);
    expect(error.code).toBe('AUDIT_WRITE_FAILED');
    expect(error.cause).toBe(cause);
  });

  it('auditWriteFailed() works with no cause supplied', () => {
    const error = auditWriteFailed();

    expect(error.status).toBe(500);
    expect(error.code).toBe('AUDIT_WRITE_FAILED');
    expect(error.cause).toBeUndefined();
  });
});

describe('user-management error factories (design.md D14)', () => {
  it('userNotFound() is a 404 AppError with code USER_NOT_FOUND, distinct from notFoundEnvelope()', () => {
    const error = userNotFound();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('USER_NOT_FOUND');
    expect(error.code).not.toBe('NOT_FOUND');
  });

  it('emailAlreadyInUse() is a 409 AppError with code EMAIL_ALREADY_IN_USE (not 422 — the request is valid, the collection state conflicts)', () => {
    const error = emailAlreadyInUse();

    expect(error.status).toBe(409);
    expect(error.code).toBe('EMAIL_ALREADY_IN_USE');
  });

  it('lastActiveEncargado() is a 409 AppError with code LAST_ACTIVE_ENCARGADO', () => {
    const error = lastActiveEncargado();

    expect(error.status).toBe(409);
    expect(error.code).toBe('LAST_ACTIVE_ENCARGADO');
  });

  it('toErrorEnvelope() maps userNotFound() to a 404 { error: { code: "USER_NOT_FOUND" } } envelope', () => {
    const result = toErrorEnvelope(userNotFound());

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: { code: 'USER_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('toErrorEnvelope() maps emailAlreadyInUse() to a 409 { error: { code: "EMAIL_ALREADY_IN_USE" } } envelope', () => {
    const result = toErrorEnvelope(emailAlreadyInUse());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'EMAIL_ALREADY_IN_USE', message: expect.any(String) },
    });
  });

  it('toErrorEnvelope() maps lastActiveEncargado() to a 409 { error: { code: "LAST_ACTIVE_ENCARGADO" } } envelope', () => {
    const result = toErrorEnvelope(lastActiveEncargado());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'LAST_ACTIVE_ENCARGADO', message: expect.any(String) },
    });
  });
});

describe('supplier-management error factories (design.md D12, S3a slice)', () => {
  it('supplierNameInUse() is a 409 AppError with code SUPPLIER_NAME_IN_USE and no details', () => {
    const error = supplierNameInUse();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('SUPPLIER_NAME_IN_USE');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps supplierNameInUse() to a 409 { error: { code: "SUPPLIER_NAME_IN_USE" } } envelope', () => {
    const result = toErrorEnvelope(supplierNameInUse());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'SUPPLIER_NAME_IN_USE', message: expect.any(String) },
    });
  });

  it('supplierNotFound() is a 404 AppError with code SUPPLIER_NOT_FOUND and no details', () => {
    const error = supplierNotFound();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('SUPPLIER_NOT_FOUND');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps supplierNotFound() to a 404 { error: { code: "SUPPLIER_NOT_FOUND" } } envelope', () => {
    const result = toErrorEnvelope(supplierNotFound());

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: { code: 'SUPPLIER_NOT_FOUND', message: expect.any(String) },
    });
  });
});

describe('product-management error factories (tasks.md 1.5, backlog #5, S1a)', () => {
  it('productNotFound() is a 404 AppError with code PRODUCT_NOT_FOUND and no details', () => {
    const error = productNotFound();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps productNotFound() to a 404 { error: { code: "PRODUCT_NOT_FOUND" } } envelope', () => {
    const result = toErrorEnvelope(productNotFound());

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: { code: 'PRODUCT_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('skuAlreadyInUse() is a 409 AppError with code SKU_ALREADY_IN_USE and no details', () => {
    const error = skuAlreadyInUse();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('SKU_ALREADY_IN_USE');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps skuAlreadyInUse() to a 409 { error: { code: "SKU_ALREADY_IN_USE" } } envelope', () => {
    const result = toErrorEnvelope(skuAlreadyInUse());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'SKU_ALREADY_IN_USE', message: expect.any(String) },
    });
  });

  it('fieldReservedForEncargado() is a 403 AppError with code FIELD_RESERVED_FOR_ENCARGADO and no details', () => {
    const error = fieldReservedForEncargado();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('FIELD_RESERVED_FOR_ENCARGADO');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps fieldReservedForEncargado() to a 403 { error: { code: "FIELD_RESERVED_FOR_ENCARGADO" } } envelope', () => {
    const result = toErrorEnvelope(fieldReservedForEncargado());

    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: 'FIELD_RESERVED_FOR_ENCARGADO',
        message: expect.any(String),
      },
    });
  });

  it('supplierInactive() is a 409 AppError with code SUPPLIER_INACTIVE and no details', () => {
    const error = supplierInactive();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('SUPPLIER_INACTIVE');
    expect(error.details).toBeUndefined();
  });

  it('toErrorEnvelope() maps supplierInactive() to a 409 { error: { code: "SUPPLIER_INACTIVE" } } envelope', () => {
    const result = toErrorEnvelope(supplierInactive());

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: { code: 'SUPPLIER_INACTIVE', message: expect.any(String) },
    });
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
