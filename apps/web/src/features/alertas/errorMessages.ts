import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, following `features/productos/errorMessages.ts`'s
 * shape. Switches on `error.code`, never `error.status`.
 */
export function alertasErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'ALERT_NOT_FOUND':
      return 'No se encontró la alerta solicitada.';
    case 'ALERT_ALREADY_RESOLVED':
      return 'La alerta ya fue resuelta.';
    case 'ALERT_NOT_MANUALLY_RESOLVABLE':
      return 'Este tipo de alerta no se puede resolver manualmente.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
