import { describe, expect, it, vi } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { TxControl } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import type { VentasRepo } from '../ventas/repository.js';
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

  // SEC-001. The lockout is evaluated AFTER the password, per ADR-0007
  // § Actualizado 2026-08-29. Checking it first turned a guessing defence
  // into a denial of service: anyone who knew the only encargado's email
  // could keep them out indefinitely with five requests every five minutes,
  // well under the route's 10/min limit, and the counter only cleared on a
  // successful login the owner was being prevented from performing.
  //
  // SECURITY-REPORT.md S01, owner-ratified 2026-09-01: a WRONG password
  // against a locked account is now indistinguishable from an unknown
  // email — INVALID_CREDENTIALS, not the informative ACCOUNT_LOCKED. The
  // status code was the enumeration oracle; DUMMY_HASH only equalized
  // timing, never the response shape.
  it('rejects a locked account whose password is also wrong (INVALID_CREDENTIALS, not ACCOUNT_LOCKED)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({
      hashContrasena: hash,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    const registerFailedAttempt = vi.fn(async () => ({
      intentosFallidos: 6,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    }));
    const repos = fakeRepos({
      findByEmail: async () => usuario,
      registerFailedAttempt,
    });

    await expect(
      login(repos, { email: 'test@example.com', password: 'wrong-password' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      details: undefined,
    });
    // Already locked: the window is not extended by an attempt it already
    // refuses, so the owner's wait never grows while an attacker keeps trying.
    expect(registerFailedAttempt).not.toHaveBeenCalled();
  });

  // SECURITY-REPORT.md S01, owner-ratified 2026-09-01: a correct password
  // no longer silently bypasses the lockout — that made the 423/401 split
  // an enumeration oracle by construction (only the true owner could ever
  // reach the branch that logged in, so success itself leaked existence
  // just as much as the old 423 did). The owner is still refused, but
  // informatively: 423 with retryAfter, since they are the one caller who
  // has just proven they know the account exists.
  it('refuses the legitimate holder while locked with the informative 423, not a silent login (SEC-001 / S01)', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({
      hashContrasena: hash,
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() + 120_000),
    });
    const resetAttempts = vi.fn(async () => {});
    const repos = fakeRepos({
      findByEmail: async () => usuario,
      resetAttempts,
    });

    await expect(
      login(repos, {
        email: 'test@example.com',
        password: 'correct-horse-battery-staple',
      }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      details: { retryAfter: expect.any(Number) },
    });
    // The lock is not silently cleared just because the password matched.
    expect(resetAttempts).not.toHaveBeenCalled();
  });

  it('lets the legitimate holder in once the lock has actually elapsed, resetting the counter', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const usuario = makeUsuario({
      hashContrasena: hash,
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() - 1_000), // already elapsed
    });
    const resetAttempts = vi.fn(async () => {});
    const repos = fakeRepos({
      findByEmail: async () => usuario,
      resetAttempts,
    });

    const result = await login(repos, {
      email: 'test@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(result.usuario.id).toBe(usuario.id);
    expect(resetAttempts).toHaveBeenCalledWith(usuario.id);
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
    // touches proveedores/productos/movimientos, unlike auth/service.ts's
    // own two-key local `Repos` that `login`/`logout`/`resolveSession` use
    // above.
    proveedores: {} as ProveedoresRepo,
    productos: {} as ProductosRepo,
    movimientos: {} as MovimientosRepo,
    ventas: {} as VentasRepo,
    alertas: {} as AlertasRepo,
  };
  const state = { committed: false, calls: 0 };
  const fakeTx: TxControl = { savepoint: async (_name, w) => w() };
  async function run<T>(
    work: (r: typeof repos, tx: TxControl) => Promise<T>,
  ): Promise<T> {
    state.calls += 1;
    const result = await work(repos, fakeTx);
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
