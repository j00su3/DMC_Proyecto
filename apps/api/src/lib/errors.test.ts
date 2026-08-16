import { describe, expect, it } from 'vitest';
import { AppError, notFoundEnvelope, toErrorEnvelope } from './errors.js';

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
