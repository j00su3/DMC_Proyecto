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
 *
 * `SALE_ALREADY_VOIDED` (Phase 6.3, backlog #9) is the anulación route's
 * 409 conflict — surfaced by `AnularVentaModal`'s `serverError` without
 * closing the modal, mirroring `movimientosErrorMessage`'s pattern.
 */
export function reciboErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'SALE_NOT_FOUND':
      return 'No se encontró ningún recibo con ese número o identificador.';
    case 'SALE_ALREADY_VOIDED':
      return 'Esta venta ya fue anulada.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
