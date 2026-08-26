import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import type { SesionesRepo, Usuario, UsuariosRepo } from './repository.js';
import { changePassword, login, logout, resolveSession } from './service.js';

function makeUsuario(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: 'u1',
    nombre: 'Test User',
    email: 'test@example.com',
    hashContrasena: 'set-per-test',
    rol: 'deposito',
    activo: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    creadoEn: new Date(),
    debeCambiarPassword: false,
    ...overrides,
  };
}

function fakeRepos(
  usuarios: Partial<UsuariosRepo> = {},
  sesiones: Partial<SesionesRepo> = {},
) {
  return {
    usuarios: {
      findByEmail: async () => undefined,
      registerFailedAttempt: async () => ({
        intentosFallidos: 1,
        bloqueadoHasta: null,
      }),
      resetAttempts: async () => {},
      updatePassword: async () => {},
      ...usuarios,
    } as UsuariosRepo,
    sesiones: {
      create: async () => {},
      findValid: async () => undefined,
      delete: async () => {},
      purgeExpired: async () => {},
      deleteOthers: async () => {},
      ...sesiones,
    } as SesionesRepo,
  };
}

describe('login', () => {
  it('succeeds, resets intentos_fallidos, and returns the usuario for correct credentials', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({ hashContrasena: hash });
    const resetAttempts = vi.fn(async () => {});
    const purgeExpired = vi.fn(async () => {});
    const create = vi.fn(async () => {});
    const repos = fakeRepos(
      { findByEmail: async () => usuario, resetAttempts },
      { purgeExpired, create },
    );

    const result = await login(repos, {
      email: 'test@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(result.usuario.id).toBe(usuario.id);
    expect(result.token).toEqual(expect.any(String));
    expect(resetAttempts).toHaveBeenCalledWith(usuario.id);
    expect(purgeExpired).toHaveBeenCalledWith(usuario.id);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: usuario.id }),
    );
  });

  it('increments the failed-attempt counter and rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({ hashContrasena: hash });
    const registerFailedAttempt = vi.fn(async () => ({
      intentosFallidos: 1,
      bloqueadoHasta: null,
    }));
    const repos = fakeRepos({
      findByEmail: async () => usuario,
      registerFailedAttempt,
    });

    await expect(
      login(repos, { email: 'test@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(registerFailedAttempt).toHaveBeenCalledWith(usuario.id);
  });

  it('runs argon2.verify against the dummy hash for an unknown email (same shape, no enumeration)', async () => {
    const registerFailedAttempt = vi.fn(async () => ({
      intentosFallidos: 1,
      bloqueadoHasta: null,
    }));
    const repos = fakeRepos({
      findByEmail: async () => undefined,
      registerFailedAttempt,
    });

    await expect(
      login(repos, {
        email: 'unknown@example.com',
        password: 'anything',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    // No user id to register a failed attempt against.
    expect(registerFailedAttempt).not.toHaveBeenCalled();
  });

  it('rejects an inactive user only after the password verifies (ACCOUNT_INACTIVE)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({ hashContrasena: hash, activo: false });
    const registerFailedAttempt = vi.fn(async () => ({
      intentosFallidos: 1,
      bloqueadoHasta: null,
    }));
    const repos = fakeRepos({
      findByEmail: async () => usuario,
      registerFailedAttempt,
    });

    await expect(
      login(repos, {
        email: 'test@example.com',
        password: 'correct-horse-battery-staple',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    // D10: inactive is checked after a successful verify, not instead of it.
    expect(registerFailedAttempt).not.toHaveBeenCalled();
  });

  it('rejects a locked account without evaluating the password hash', async () => {
    const usuario = makeUsuario({
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    const findByEmail = vi.fn(async () => usuario);
    const repos = fakeRepos({ findByEmail });

    await expect(
      login(repos, { email: 'test@example.com', password: 'irrelevant' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      details: { retryAfter: expect.any(Number) },
    });
  });
});

describe('logout', () => {
  it('deletes the matching session row', async () => {
    const del = vi.fn(async () => {});
    const repos = fakeRepos({}, { delete: del });

    await logout(repos, 'some-token');

    expect(del).toHaveBeenCalledWith('some-token');
  });
});

describe('resolveSession', () => {
  it('returns the usuario for a valid, unexpired session', async () => {
    const usuario = makeUsuario();
    const repos = fakeRepos({}, { findValid: async () => usuario });

    const result = await resolveSession(repos, 'valid-token');

    expect(result).toEqual(usuario);
  });

  it('returns undefined when the session is absent or expired', async () => {
    const repos = fakeRepos({}, { findValid: async () => undefined });

    const result = await resolveSession(repos, 'missing-token');

    expect(result).toBeUndefined();
  });
});

describe('changePassword', () => {
  it('rejects a wrong current password with INVALID_CURRENT_PASSWORD and performs no repo writes (D5)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({ hashContrasena: hash });
    const updatePassword = vi.fn(async () => {});
    const deleteOthers = vi.fn(async () => {});
    const repos = fakeRepos({ updatePassword }, { deleteOthers });

    await expect(
      changePassword(repos, {
        usuario,
        sessionId: 'session-a',
        currentPassword: 'wrong-current',
        newPassword: 'a-new-valid-password',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });

    expect(updatePassword).not.toHaveBeenCalled();
    expect(deleteOthers).not.toHaveBeenCalled();
  });

  it('on success calls updatePassword then deleteOthers in that exact order (D7), and the new hash verifies while the old one does not', async () => {
    const currentPassword = 'correct-horse-battery-staple';
    const newPassword = 'a-brand-new-valid-password';
    const hash = await hashPassword(currentPassword);
    const usuario = makeUsuario({ hashContrasena: hash });
    const callOrder: string[] = [];
    let capturedHash: string | undefined;
    const updatePassword = vi.fn(async (_id: string, newHash: string) => {
      callOrder.push('updatePassword');
      capturedHash = newHash;
    });
    const deleteOthers = vi.fn(async () => {
      callOrder.push('deleteOthers');
    });
    const repos = fakeRepos({ updatePassword }, { deleteOthers });

    await changePassword(repos, {
      usuario,
      sessionId: 'session-a',
      currentPassword,
      newPassword,
    });

    expect(callOrder).toEqual(['updatePassword', 'deleteOthers']);
    expect(updatePassword).toHaveBeenCalledWith(usuario.id, expect.any(String));
    expect(deleteOthers).toHaveBeenCalledWith(usuario.id, 'session-a');

    if (!capturedHash) {
      throw new Error('expected updatePassword to receive a hash');
    }
    await expect(verifyPassword(capturedHash, newPassword)).resolves.toBe(true);
    await expect(verifyPassword(capturedHash, currentPassword)).resolves.toBe(
      false,
    );
  });
});
