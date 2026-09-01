import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, following
 * `features/pos/errorMessages.ts`'s shape. Switches on `error.code`, never
 * `error.status`.
 *
 * `SALE_NOT_FOUND` maps to PD-5's single generic message — identical string
 * for both the detail route's not-found state and the search's not-found
 * state, since D2's one wire code deliberately erases the "wrong number" vs.
 * "access denied" distinction (moot under PD-4's audit-style access).
 */
export function reciboErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'SALE_NOT_FOUND':
      return 'No se encontró ningún recibo con ese número o identificador.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
