import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, one distinct message per code,
 * following `features/productos/errorMessages.ts`'s shape. Switches on
 * `error.code`, never `error.status`.
 */
export function proveedoresErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'SUPPLIER_NOT_FOUND':
      return 'No se encontró el proveedor solicitado.';
    case 'SUPPLIER_NAME_IN_USE':
      return 'Ese nombre ya está en uso por otro proveedor.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
