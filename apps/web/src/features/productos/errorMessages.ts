import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, one distinct message per code,
 * following `features/usuarios/errorMessages.ts`'s shape. Switches on
 * `error.code`, never `error.status`.
 */
export function productosErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'PRODUCT_NOT_FOUND':
      return 'No se encontró el producto solicitado.';
    case 'SKU_ALREADY_IN_USE':
      return 'Ese SKU ya está en uso por otro producto.';
    case 'FIELD_RESERVED_FOR_ENCARGADO':
      return 'Solo un encargado puede modificar el stock mínimo.';
    case 'SUPPLIER_INACTIVE':
      return 'El proveedor seleccionado está inactivo y no puede usarse en productos nuevos.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
