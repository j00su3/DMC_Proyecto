import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { usuariosErrorMessage } from './errorMessages.js';

describe('usuariosErrorMessage', () => {
  it('returns a message for USER_NOT_FOUND', () => {
    const error = new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    expect(usuariosErrorMessage(error)).toBe(
      'No se encontró el usuario solicitado.',
    );
  });

  it('returns a message for EMAIL_ALREADY_IN_USE', () => {
    const error = new ApiError(409, 'EMAIL_ALREADY_IN_USE', 'Email in use');
    expect(usuariosErrorMessage(error)).toBe(
      'Ese correo electrónico ya está en uso por otro usuario.',
    );
  });

  it('returns a distinct message for LAST_ACTIVE_ENCARGADO (never the same as EMAIL_ALREADY_IN_USE, both are 409)', () => {
    const error = new ApiError(
      409,
      'LAST_ACTIVE_ENCARGADO',
      'Last active encargado',
    );
    expect(usuariosErrorMessage(error)).toBe(
      'No se puede desactivar: es el último encargado activo. Asigne el rol de encargado a otra persona antes de continuar.',
    );
  });

  it('returns a message for VALIDATION_ERROR', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Invalid input');
    expect(usuariosErrorMessage(error)).toBe(
      'Revise los datos ingresados e intente de nuevo.',
    );
  });

  it('returns a message for FORBIDDEN', () => {
    const error = new ApiError(403, 'FORBIDDEN', 'Forbidden');
    expect(usuariosErrorMessage(error)).toBe(
      'No tiene permiso para realizar esta acción.',
    );
  });

  it('returns a distinct fallback message for an unknown code', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'Unexpected');
    expect(usuariosErrorMessage(error)).toBe(
      'Ocurrió un error inesperado. Intente de nuevo.',
    );
  });
});
