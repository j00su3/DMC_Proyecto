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
    options?: { cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
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

// D5: a failed audit write must not be swallowed or mapped to the generic
// INTERNAL_ERROR — a distinct code separates "the feature is broken" from
// "the trail is broken" for logs and support. `cause` is preserved so the
// underlying repo/database error is not lost.
export function auditWriteFailed(cause?: unknown): AppError {
  return new AppError(
    'AUDIT_WRITE_FAILED',
    'Failed to record the audit trail for this operation',
    500,
    undefined,
    { cause },
  );
}

// D14: distinct from notFoundEnvelope() (reserved for unmatched routes) so
// "no such path" and "no such user" stay distinguishable in logs and clients.
export function userNotFound(): AppError {
  return new AppError('USER_NOT_FOUND', 'User not found', 404);
}

// D14: 409 not 422 — the request itself is valid, it is the current state of
// the users collection (another active row already owns this email) that
// conflicts, and the conflict is resolvable by changing that state.
export function emailAlreadyInUse(): AppError {
  return new AppError(
    'EMAIL_ALREADY_IN_USE',
    'Email is already in use by another user',
    409,
  );
}

// D14: 409 not 422 — same reasoning as emailAlreadyInUse(): the request is
// valid, but honoring it would leave the encargado role with zero active
// members, which conflicts with the current state of the users collection.
export function lastActiveEncargado(): AppError {
  return new AppError(
    'LAST_ACTIVE_ENCARGADO',
    'Cannot deactivate or demote the last active encargado',
    409,
  );
}

// design.md D12: 409 not 422 — same reasoning as emailAlreadyInUse(). The
// wire code is taken verbatim from the ratified spec
// (specs/supplier-management/spec.md). Moved into S3a (ahead of the rest of
// S4's error factories) because proveedores/repository.ts's create/update
// throw it directly on a caught 23505 and cannot compile without it.
export function supplierNameInUse(): AppError {
  return new AppError(
    'SUPPLIER_NAME_IN_USE',
    'Supplier name is already in use by another supplier',
    409,
  );
}

// design.md D7: thrown by the service when findByIdForUpdate returns
// undefined, never by the repository (see proveedores/repository.ts's
// expectOneRow precedent). D14: distinct from notFoundEnvelope() so "no such
// path" and "no such supplier" stay distinguishable in logs and clients.
export function supplierNotFound(): AppError {
  return new AppError('SUPPLIER_NOT_FOUND', 'Supplier not found', 404);
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
