/**
 * A typed failure from the API, carrying the `code` the UI branches on.
 *
 * Exception-based rather than a Result type because TanStack Query's error
 * channel is exceptions; a Result would fight every call site.
 */
export class ApiError extends Error {
  /** HTTP status of the response. */
  readonly status: number;
  /** UPPER_SNAKE code from the server envelope, e.g. `ACCOUNT_LOCKED`. */
  readonly code: string;
  /** Code-specific payload, e.g. `{ retryAfter }`. Narrowed by the caller. */
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
