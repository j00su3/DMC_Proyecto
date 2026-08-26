import type { ApiError } from '../../api/errors.js';

/**
 * Pure `(ApiError) => string` mapper for the login screen. No React, no i18n
 * framework, no side effects — just the code -> copy table so `LoginForm`
 * stays presentational (design.md Interfaces, route-module boundary).
 */
export function loginErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'El correo o la contraseña son incorrectos. Verifique los datos e intente de nuevo.';
    case 'ACCOUNT_INACTIVE':
      return 'La cuenta está inactiva. Solicite ayuda al encargado.';
    case 'RATE_LIMITED':
      return 'Demasiados intentos. Espere un momento antes de volver a intentar.';
    case 'ACCOUNT_LOCKED':
      return accountLockedMessage(error.details);
    default:
      return 'Ocurrió un error inesperado. Intente de nuevo.';
  }
}

function accountLockedMessage(details: unknown): string {
  const retryAfterSeconds = readRetryAfter(details);
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const unit = minutes === 1 ? 'minuto' : 'minutos';
  return `La cuenta está bloqueada temporalmente. Intente de nuevo en ${minutes} ${unit}.`;
}

// `accountLocked()` (apps/api/src/lib/errors.ts) sends retryAfter in seconds;
// this screen speaks to the user in minutes.
function readRetryAfter(details: unknown): number {
  if (
    typeof details === 'object' &&
    details !== null &&
    'retryAfter' in details &&
    typeof (details as { retryAfter: unknown }).retryAfter === 'number'
  ) {
    return (details as { retryAfter: number }).retryAfter;
  }
  return 0;
}
