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

// tasks.md task 1.5, backlog #5 (productos-ledger-base), S1a. Same shape as
// emailAlreadyInUse()/supplierNameInUse() — no details, English UPPER_SNAKE
// wire codes per the project's two-naming-families convention.

// D14-equivalent: distinct from notFoundEnvelope() so "no such path" and "no
// such product" stay distinguishable in logs and clients.
export function productNotFound(): AppError {
  return new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404);
}

// 409 not 422 — same reasoning as emailAlreadyInUse()/supplierNameInUse():
// the request is valid, but honoring it would collide with another active
// product's sku, which conflicts with the current state of the products
// collection.
export function skuAlreadyInUse(): AppError {
  return new AppError(
    'SKU_ALREADY_IN_USE',
    'SKU is already in use by another product',
    409,
  );
}

// Owner-approved deviation from docs/TECH-DESIGNv2.md:235's ratified
// `campo_reservado_encargado` (English UPPER_SNAKE, LAST_ACTIVE_ENCARGADO
// precedent) — recorded in the proposal (D2), not re-decided here.
export function fieldReservedForEncargado(): AppError {
  return new AppError(
    'FIELD_RESERVED_FOR_ENCARGADO',
    'This field can only be set by an encargado',
    403,
  );
}

// R2 (resolved by spec — spec.md:24, :200): 409 not 422, same reasoning as
// emailAlreadyInUse() — the request is valid, but referencing an inactive
// supplier conflicts with the current state of the suppliers collection.
export function supplierInactive(): AppError {
  return new AppError(
    'SUPPLIER_INACTIVE',
    'Supplier is inactive and cannot be referenced by a new product',
    409,
  );
}

// design.md D6, backlog #6 (movimientos-inventario). RECONCILE-1 (resolved):
// the `details` key is `available`, English camelCase — the error envelope
// belongs to the English family (accountLocked's `retryAfter` precedent),
// unlike the domain wire field `esMerma` which is Spanish-domain camelCase.
// 409: the request is valid, the current stock conflicts with it, same
// reasoning as supplierInactive()/emailAlreadyInUse().
export function insufficientStock(available: number): AppError {
  return new AppError('INSUFFICIENT_STOCK', 'Insufficient stock', 409, {
    available,
  });
}

// design.md D6 — the deliberate sibling of the shipped supplierInactive().
export function productInactive(): AppError {
  return new AppError(
    'PRODUCT_INACTIVE',
    'Product is inactive and cannot receive new movements',
    409,
  );
}

// design.md D8, RECONCILE-5 (resolved): MOVEMENT_REASON_REQUIRED, not the
// spec's bare REASON_REQUIRED — backlog #9's anulación will need its own
// reason code, so an unprefixed name would collide. 400 because a
// conditionally-required field is a request-validity problem, not a state
// conflict — invalidCurrentPassword() is the 400 precedent.
export function movementReasonRequired(): AppError {
  return new AppError(
    'MOVEMENT_REASON_REQUIRED',
    'A reason is required for this movement',
    400,
  );
}

// design.md D12/D13, tasks.md RECONCILE-1 (resolved). English UPPER_SNAKE
// per the two-naming-families rule. 400 — the request itself is
// unrepresentable (a duplicate line the cart is supposed to have merged
// before submission), not a state conflict.
export function duplicateSaleItem(): AppError {
  return new AppError(
    'DUPLICATE_SALE_ITEM',
    'A product cannot appear more than once in the same sale request',
    400,
  );
}

// design.md D12, RECONCILE-1: spec L101-104. 400 — same reasoning as
// duplicateSaleItem(): the payload itself carries two rows for one medio,
// which the cashier's UI is supposed to have combined before submission.
export function paymentMediumDuplicated(): AppError {
  return new AppError(
    'PAYMENT_MEDIUM_DUPLICATED',
    'A payment medium cannot appear more than once in the same sale request',
    400,
  );
}

// design.md D12, RECONCILE-1: spec L63-67 (PD-1). 409 — the request is
// valid, but the current payment sum conflicts with the sale's total.
// `details.total`/`details.pagado` are English camelCase (accountLocked's
// `retryAfter`/insufficientStock's `available` precedent), both decimal
// strings — same wire shape as every other money field.
export function paymentBelowTotal(total: string, pagado: string): AppError {
  return new AppError(
    'PAYMENT_BELOW_TOTAL',
    'The sum of payments is below the sale total',
    409,
    { total, pagado },
  );
}

// design.md D12, RECONCILE-1: spec L85-88 (card-only exceeds total) and
// proposal PD-10 (non-cash payments exceeding the total even alongside a
// cash row — cash cannot correct a non-cash overcharge). 409 — the request
// is valid, but the current non-cash payment sum conflicts with the total.
export function cashlessPaymentMustMatchTotal(): AppError {
  return new AppError(
    'CASHLESS_PAYMENT_MUST_MATCH_TOTAL',
    'Non-cash payments cannot exceed the sale total',
    409,
  );
}

// design.md D5/D12, RECONCILE-1: spec L119-134 (PD-6). 409 — the request is
// valid, but the server's current price for one or more items conflicts
// with the price the cashier last acknowledged. `details.items` lists every
// mismatched line at once (D5) so re-confirmation is not a per-line loop.
export function priceChanged(
  items: Array<{
    productoId: string;
    precioEsperado: string;
    precioActual: string;
  }>,
): AppError {
  return new AppError(
    'PRICE_CHANGED',
    'One or more item prices changed since they were added to the sale',
    409,
    { items },
  );
}

// design.md D1/D12: thrown when the dinero module's overflow guard trips
// (MontoFueraDeRangoError) — see apps/api/src/lib/dinero.ts. 400 because the
// request itself produced a value outside numeric(12,2)'s representable
// range, never a raw Postgres 22003 (#6's S3 rule).
export function saleAmountOutOfRange(): AppError {
  return new AppError(
    'SALE_AMOUNT_OUT_OF_RANGE',
    'The sale amount is outside the representable range',
    400,
  );
}

// design.md D2 (recibo-interno, backlog #8). Same shape as
// productNotFound()/supplierNotFound(): no `details`, English UPPER_SNAKE
// per the two-naming-families rule — `SALE` is already this repo's English
// noun for `venta` (DUPLICATE_SALE_ITEM, SALE_AMOUNT_OUT_OF_RANGE above).
// One code serves both the `:id` and `:numeroCorrelativo` lookups (PD-5).
// Thrown by the service, never the repository (productos/service.ts's
// getProducto precedent).
export function saleNotFound(): AppError {
  return new AppError('SALE_NOT_FOUND', 'Sale not found', 404);
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
