import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper, one distinct message per code —
 * following `features/auth/errorMessages.ts`'s shape (D15). Switches on
 * `error.code`, never `error.status`: PATCH returns 409 for both
 * `EMAIL_ALREADY_IN_USE` and `LAST_ACTIVE_ENCARGADO`, so a status-based
 * branch cannot tell them apart.
 */
export function usuariosErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'USER_NOT_FOUND':
      return 'No se encontró el usuario solicitado.';
    case 'EMAIL_ALREADY_IN_USE':
      return 'Ese correo electrónico ya está en uso por otro usuario.';
    case 'LAST_ACTIVE_ENCARGADO':
      return 'No se puede desactivar: es el último encargado activo. Asigne el rol de encargado a otra persona antes de continuar.';
    case 'VALIDATION_ERROR':
      return 'Revise los datos ingresados e intente de nuevo.';
    case 'FORBIDDEN':
      return 'No tiene permiso para realizar esta acción.';
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}
