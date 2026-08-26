import { z } from 'zod';

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface MappedError {
  status: number;
  body: ErrorEnvelope;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface FastifyValidationLikeError {
  validation: unknown[];
}

function hasValidationErrors(
  error: unknown,
): error is FastifyValidationLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray((error as FastifyValidationLikeError).validation) &&
    (error as FastifyValidationLikeError).validation.length > 0
  );
}

interface FastifyRateLimitLikeError {
  statusCode: 429;
}

function isRateLimitError(error: unknown): error is FastifyRateLimitLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 429
  );
}

export function unauthorized(message = 'Authentication required'): AppError {
  return new AppError('UNAUTHORIZED', message, 401);
}

export function forbidden(message = 'Insufficient permissions'): AppError {
  return new AppError('FORBIDDEN', message, 403);
}

// retryAfter is seconds until the lockout lifts (design.md D9).
export function accountLocked(retryAfter: number): AppError {
  return new AppError('ACCOUNT_LOCKED', 'Account is temporarily locked', 423, {
    retryAfter,
  });
}

export function invalidCredentials(): AppError {
  return new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
}

export function accountInactive(): AppError {
  return new AppError('ACCOUNT_INACTIVE', 'Account is inactive', 401);
}

// R1 (reconciled from spec's MUST_CHANGE_PASSWORD): existing codes are state
// descriptions, not imperatives (design.md D4).
export function passwordChangeRequired(): AppError {
  return new AppError(
    'PASSWORD_CHANGE_REQUIRED',
    'Password change required before continuing',
    403,
  );
}

// R2 (reconciled from spec's 401 INVALID_CREDENTIALS): the session is valid,
// so a 401 would trip the SPA's global session-expiry recovery and discard
// the user's typed input (design.md D5).
export function invalidCurrentPassword(): AppError {
  return new AppError(
    'INVALID_CURRENT_PASSWORD',
    'Current password is incorrect',
    400,
  );
}

export function toErrorEnvelope(error: unknown): MappedError {
  if (hasValidationErrors(error)) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      },
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
    };
  }

  if (isRateLimitError(error)) {
    return {
      status: 429,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    },
  };
}

export function notFoundEnvelope(): MappedError {
  return {
    status: 404,
    body: {
      error: {
        code: 'NOT_FOUND',
        message: 'Not Found',
      },
    },
  };
}
