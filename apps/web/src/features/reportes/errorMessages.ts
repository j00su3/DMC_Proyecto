import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, following
 * `features/alertas/errorMessages.ts`'s shape. Switches on `error.code`,
 * never `error.status`.
 */
export function reportesErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'El rango de fechas ingresado no es válido.';
    case 'FORBIDDEN':
      return 'No tiene permiso para ver este reporte.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
