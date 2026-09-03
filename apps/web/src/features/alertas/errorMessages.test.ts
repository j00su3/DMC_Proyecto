import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { alertasErrorMessage } from './errorMessages.js';

describe('alertasErrorMessage', () => {
  it('maps ALERT_NOT_FOUND to a specific message', () => {
    const error = new ApiError(404, 'ALERT_NOT_FOUND', 'not found');
    expect(alertasErrorMessage(error)).toBe(
      'No se encontró la alerta solicitada.',
    );
  });

  it('maps ALERT_ALREADY_RESOLVED to a distinct message (triangulation)', () => {
    const error = new ApiError(409, 'ALERT_ALREADY_RESOLVED', 'already');
    expect(alertasErrorMessage(error)).toBe('La alerta ya fue resuelta.');
  });

  it('maps ALERT_NOT_MANUALLY_RESOLVABLE to a distinct message', () => {
    const error = new ApiError(
      409,
      'ALERT_NOT_MANUALLY_RESOLVABLE',
      'not resolvable',
    );
    expect(alertasErrorMessage(error)).toBe(
      'Este tipo de alerta no se puede resolver manualmente.',
    );
  });

  it('falls back to a generic message for an unmapped code', () => {
    const error = new ApiError(500, 'SOMETHING_ELSE', 'boom');
    expect(alertasErrorMessage(error)).toBe(
      'Ocurrió un error inesperado. Intente de nuevo.',
    );
  });
});
