import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.js';
import { loginErrorMessage } from './errorMessages.js';

describe('loginErrorMessage', () => {
  it('returns a message for INVALID_CREDENTIALS', () => {
    const error = new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    );

    expect(loginErrorMessage(error)).toBe(
      'El correo o la contraseña son incorrectos. Verifique los datos e intente de nuevo.',
    );
  });

  it('returns a message for ACCOUNT_INACTIVE', () => {
    const error = new ApiError(401, 'ACCOUNT_INACTIVE', 'Account is inactive');

    expect(loginErrorMessage(error)).toBe(
      'La cuenta está inactiva. Solicite ayuda al encargado.',
    );
  });

  it('returns a message for RATE_LIMITED', () => {
    const error = new ApiError(429, 'RATE_LIMITED', 'Too many requests');

    expect(loginErrorMessage(error)).toBe(
      'Demasiados intentos. Espere un momento antes de volver a intentar.',
    );
  });

  it('derives ACCOUNT_LOCKED message from details.retryAfter (seconds -> minutes, rounded up)', () => {
    const error = new ApiError(
      423,
      'ACCOUNT_LOCKED',
      'Account is temporarily locked',
      {
        retryAfter: 90,
      },
    );

    expect(loginErrorMessage(error)).toBe(
      'La cuenta está bloqueada temporalmente. Intente de nuevo en 2 minutos.',
    );
  });

  it('pluralizes ACCOUNT_LOCKED message for a single minute', () => {
    const error = new ApiError(
      423,
      'ACCOUNT_LOCKED',
      'Account is temporarily locked',
      {
        retryAfter: 60,
      },
    );

    expect(loginErrorMessage(error)).toBe(
      'La cuenta está bloqueada temporalmente. Intente de nuevo en 1 minuto.',
    );
  });

  it('returns a distinct message for an unknown code', () => {
    const error = new ApiError(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred',
    );

    expect(loginErrorMessage(error)).toBe(
      'Ocurrió un error inesperado. Intente de nuevo.',
    );
  });
});
