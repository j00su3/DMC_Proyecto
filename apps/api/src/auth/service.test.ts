import { describe, expect, it, vi } from 'vitest';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SesionesRepo } from './repository.js';
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

// Wraps fakeRepos with an `auditoria` fake and a `run` that mimics
// `db.transaction`: work only "commits" (state.committed becomes true) if
// the callback resolves. If the callback throws, `run` rejects and
// `committed` stays false — the same observable shape a real Postgres
// rollback produces (design.md D1, R1).
function fakeUow(
  overrides: {
    usuarios?: Partial<UsuariosRepo>;
    sesiones?: Partial<SesionesRepo>;
    auditoria?: Partial<AuditoriaRepo>;
  } = {},
) {
  const repos = {
    ...fakeRepos(overrides.usuarios, overrides.sesiones),
    auditoria: {
      record: async () => {},
      ...overrides.auditoria,
    } as AuditoriaRepo,
    // Only present so `run`'s callback satisfies the plugin-wide `Repos`
    // type that `UnitOfWork` (db/uow.ts) requires — changePassword() never
    // touches proveedores, unlike auth/service.ts's own two-key local
    // `Repos` that `login`/`logout`/`resolveSession` use above.
    proveedores: {} as ProveedoresRepo,
  };
  const state = { committed: false, calls: 0 };
  async function run<T>(work: (r: typeof repos) => Promise<T>): Promise<T> {
    state.calls += 1;
    const result = await work(repos);
    state.committed = true;
    return result;
  }
  return { run, state };
}

describe('changePassword', () => {
  it('rejects a wrong current password with INVALID_CURRENT_PASSWORD and never opens a transaction (D5)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({ hashContrasena: hash });
    const uow = fakeUow();

    await expect(
      changePassword(uow, {
        usuario,
        sessionId: 'session-a',
        currentPassword: 'wrong-current',
        newPassword: 'a-new-valid-password',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });

    expect(uow.state.calls).toBe(0);
  });

  it('on success runs updatePassword, deleteOthers, and auditoria.record in that order inside one uow.run (R1, D8), and the new hash verifies while the old one does not', async () => {
    const currentPassword = 'correct-horse-battery-staple';
    const newPassword = 'a-brand-new-valid-password';
    const hash = await hashPassword(currentPassword);
    const usuario = makeUsuario({
      hashContrasena: hash,
      debeCambiarPassword: true,
    });
    const callOrder: string[] = [];
    let capturedHash: string | undefined;
    let capturedEvent: unknown;
    const uow = fakeUow({
      usuarios: {
        updatePassword: async (_id, newHash) => {
          callOrder.push('updatePassword');
          capturedHash = newHash;
        },
      },
      sesiones: {
        deleteOthers: async () => {
          callOrder.push('deleteOthers');
        },
      },
      auditoria: {
        record: async (event) => {
          callOrder.push('auditoria.record');
          capturedEvent = event;
        },
      },
    });

    await changePassword(uow, {
      usuario,
      sessionId: 'session-a',
      currentPassword,
      newPassword,
    });

    expect(callOrder).toEqual([
      'updatePassword',
      'deleteOthers',
      'auditoria.record',
    ]);
    expect(uow.state.committed).toBe(true);
    // D7's non-symmetric case: datosPrevios reflects the actual prior value
    // of the one field that changes as a side effect, datosPosteriores is
    // always `false` because updatePassword always clears the flag.
    expect(capturedEvent).toMatchObject({
      entidad: 'usuarios',
      entidadId: usuario.id,
      accion: 'cambiar_password',
      usuarioId: usuario.id,
      datosPrevios: { debeCambiarPassword: true },
      datosPosteriores: { debeCambiarPassword: false },
    });

    if (!capturedHash) {
      throw new Error('expected updatePassword to receive a hash');
    }
    await expect(verifyPassword(capturedHash, newPassword)).resolves.toBe(true);
    await expect(verifyPassword(capturedHash, currentPassword)).resolves.toBe(
      false,
    );
  });

  it('propagates a failed audit write as AUDIT_WRITE_FAILED and never reports the transaction as committed (spec Scenario 4)', async () => {
    const currentPassword = 'correct-horse-battery-staple';
    const hash = await hashPassword(currentPassword);
    const usuario = makeUsuario({ hashContrasena: hash });
    const uow = fakeUow({
      auditoria: {
        record: async () => {
          throw new Error('boom');
        },
      },
    });

    await expect(
      changePassword(uow, {
        usuario,
        sessionId: 'session-a',
        currentPassword,
        newPassword: 'a-brand-new-valid-password',
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_WRITE_FAILED' });

    expect(uow.state.committed).toBe(false);
  });
});
