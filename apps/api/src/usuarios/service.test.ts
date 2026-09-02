import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { UsuarioResumen } from './repository.js';
import {
  createUsuario,
  getUsuario,
  listUsuarios,
  resetUsuarioPassword,
  setUsuarioActivo,
  updateUsuario,
} from './service.js';

// `hoisted` is shared with the vi.mock factory below, which is lifted above
// the imports — a plain module-level const would not exist yet when the
// factory runs. It carries the one fact no repo spy can observe: whether the
// transaction was open at the moment hashPassword was called (D6).
const hoisted = vi.hoisted(() => ({
  transactionOpen: false,
  hashCalledInsideTransaction: [] as boolean[],
}));

vi.mock('../auth/password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/password.js')>();
  return {
    ...actual,
    hashPassword: vi.fn((plaintext: string) => {
      hoisted.hashCalledInsideTransaction.push(hoisted.transactionOpen);
      return actual.hashPassword(plaintext);
    }),
  };
});

const ACTOR_ID = '00000000-0000-4000-8000-0000000000ff';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ENCARGADO_ID = '22222222-2222-4222-8222-222222222222';

function usuarioResumen(over: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: TARGET_ID,
    nombre: 'Ana Encargada',
    email: 'ana@example.com',
    rol: 'encargado',
    activo: true,
    debeCambiarPassword: false,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface CallRecord {
  method: string;
  insideTransaction: boolean;
}

// Stub repos plus a UnitOfWork whose `run` really does open and close, so
// the suite can assert WHERE each repo call happened, not just that it
// happened. Every stub records the transaction state at call time.
// `lockedIds` and `setActivoResult` are harness options rather than
// `mockResolvedValue` overrides on purpose: overriding the implementation
// also replaces the call recording that lives inside it, so an overridden
// spy silently drops out of `calls` and every ordering assertion goes blind.
function harness(
  options: {
    previo?: UsuarioResumen | undefined;
    lockedIds?: string[];
    setActivoResult?: UsuarioResumen;
  } = {},
) {
  hoisted.transactionOpen = false;
  hoisted.hashCalledInsideTransaction.length = 0;

  const calls: CallRecord[] = [];
  const runCount = { value: 0 };

  const spy = <T>(method: string, result: (...args: never[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, insideTransaction: hoisted.transactionOpen });
      return result(...(args as never[]));
    });

  const previo = 'previo' in options ? options.previo : usuarioResumen();

  const usuarios = {
    findByEmail: spy('findByEmail', async () => undefined),
    registerFailedAttempt: spy('registerFailedAttempt', async () => ({
      intentosFallidos: 0,
      bloqueadoHasta: null,
    })),
    resetAttempts: spy('resetAttempts', async () => {}),
    updatePassword: spy('updatePassword', async () => {}),
    list: spy('list', async () => ({ rows: [usuarioResumen()], total: 1 })),
    findById: spy('findById', async () => previo),
    findByIdForUpdate: spy('findByIdForUpdate', async () => previo),
    lockActiveEncargados: spy(
      'lockActiveEncargados',
      async () => options.lockedIds ?? [TARGET_ID],
    ),
    findLockoutState: spy('findLockoutState', async () => ({
      intentosFallidos: 3,
      bloqueadoHasta: new Date('2026-02-01T00:00:00.000Z'),
    })),
    create: spy('create', async () =>
      usuarioResumen({ debeCambiarPassword: true }),
    ),
    update: spy('update', async () => usuarioResumen({ rol: 'deposito' })),
    setActivo: spy(
      'setActivo',
      async () => options.setActivoResult ?? usuarioResumen({ activo: false }),
    ),
    resetPassword: spy('resetPassword', async () =>
      usuarioResumen({ debeCambiarPassword: true }),
    ),
  };

  const sesiones = {
    create: spy('sesiones.create', async () => {}),
    findValid: spy('sesiones.findValid', async () => undefined),
    delete: spy('sesiones.delete', async () => {}),
    purgeExpired: spy('sesiones.purgeExpired', async () => {}),
    deleteOthers: spy('sesiones.deleteOthers', async () => {}),
    deleteAllForUser: spy('sesiones.deleteAllForUser', async () => {}),
  };

  const auditoria = { record: spy('auditoria.record', async () => {}) };

  const repos = { usuarios, sesiones, auditoria } as unknown as Repos;

  const uow: UnitOfWork = {
    async run(work) {
      runCount.value += 1;
      hoisted.transactionOpen = true;
      try {
        return await work(repos, { savepoint: async (_name, fn) => fn() });
      } finally {
        hoisted.transactionOpen = false;
      }
    },
  };

  return { repos, uow, usuarios, sesiones, auditoria, calls, runCount };
}

function auditEvent(auditoria: { record: ReturnType<typeof vi.fn> }) {
  return auditoria.record.mock.calls[0]?.[0];
}

describe('listUsuarios / getUsuario', () => {
  it('passes pagination through and returns rows with the total', async () => {
    const h = harness();

    await expect(
      listUsuarios(h.repos, { page: 2, pageSize: 25 }),
    ).resolves.toEqual({ rows: [usuarioResumen()], total: 1 });
    expect(h.usuarios.list).toHaveBeenCalledWith(2, 25);
  });

  it('raises USER_NOT_FOUND when the id matches no row', async () => {
    const h = harness({ previo: undefined });

    await expect(getUsuario(h.repos, TARGET_ID)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      status: 404,
    });
  });
});

describe('createUsuario', () => {
  it('hashes outside the transaction and hands the repo a hash, never the plaintext', async () => {
    const h = harness();

    const result = await createUsuario(h.uow, {
      nombre: 'Beto Deposito',
      email: 'beto@example.com',
      rol: 'deposito',
      actorId: ACTOR_ID,
    });

    // D6: argon2id at memoryCost 19456 takes hundreds of milliseconds. Doing
    // it inside the transaction would hold a pooled connection open across
    // it for nothing.
    expect(hoisted.hashCalledInsideTransaction).toEqual([false]);

    const argument = h.usuarios.create.mock.calls[0]?.[0] as {
      hashContrasena: string;
    };
    // D8: containment by type. The plaintext leaves through the return value
    // and nowhere else — no repo argument carries it under any key.
    expect(JSON.stringify(argument)).not.toContain(result.passwordTemporal);
    expect(argument.hashContrasena).not.toBe(result.passwordTemporal);
    const { verifyPassword } = await import('../auth/password.js');
    await expect(
      verifyPassword(argument.hashContrasena, result.passwordTemporal),
    ).resolves.toBe(true);
  });

  it('files a crear audit row with a null previous snapshot and no hash', async () => {
    const h = harness();

    await createUsuario(h.uow, {
      nombre: 'Beto Deposito',
      email: 'beto@example.com',
      rol: 'deposito',
      actorId: ACTOR_ID,
    });

    // D7: datosPrevios is null iff the verb is `crear` — the CHECK
    // constraint in the schema enforces the same thing at the database.
    expect(auditEvent(h.auditoria)).toMatchObject({
      entidad: 'usuarios',
      entidadId: TARGET_ID,
      accion: 'crear',
      usuarioId: ACTOR_ID,
      datosPrevios: null,
    });
    expect(
      JSON.stringify(auditEvent(h.auditoria)?.datosPosteriores),
    ).not.toContain('hashContrasena');
  });

  it('never takes the encargado set lock — a create cannot remove admin capability', async () => {
    const h = harness();

    await createUsuario(h.uow, {
      nombre: 'Cata Encargada',
      email: 'cata@example.com',
      rol: 'encargado',
      actorId: ACTOR_ID,
    });

    expect(h.usuarios.lockActiveEncargados).not.toHaveBeenCalled();
  });
});

describe('updateUsuario', () => {
  it('writes nothing and files no audit row when the request changes nothing', async () => {
    const h = harness();

    const result = await updateUsuario(h.uow, {
      id: TARGET_ID,
      cambios: { nombre: 'Ana Encargada' },
      actorId: ACTOR_ID,
    });

    // D5: `actualizar` names a transition. A row whose diff is empty asserts
    // a transition that did not happen and pollutes the trail #2.2 exists
    // to keep trustworthy.
    expect(result).toEqual(usuarioResumen());
    expect(h.usuarios.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('treats a differently-cased email as no change at all', async () => {
    const h = harness();

    await updateUsuario(h.uow, {
      id: TARGET_ID,
      cambios: { email: '  ANA@EXAMPLE.COM  ' },
      actorId: ACTOR_ID,
    });

    // The repo normalizes on write (D9). If the diff compared raw input it
    // would see a change that the database would then store identically —
    // a write and an audit row for nothing.
    expect(h.usuarios.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('does not take the set lock for a name edit', async () => {
    const h = harness();

    await updateUsuario(h.uow, {
      id: TARGET_ID,
      cambios: { nombre: 'Ana Renombrada' },
      actorId: ACTOR_ID,
    });

    // D3: the lock decision comes from the REQUEST SHAPE, before the target
    // is read. A name edit cannot remove admin capability, so this path
    // holds exactly one usuarios lock and can never join a deadlock cycle.
    expect(h.usuarios.lockActiveEncargados).not.toHaveBeenCalled();
  });

  it('does not take the set lock when promoting to encargado', async () => {
    const h = harness({ previo: usuarioResumen({ rol: 'deposito' }) });

    await updateUsuario(h.uow, {
      id: TARGET_ID,
      cambios: { rol: 'encargado' },
      actorId: ACTOR_ID,
    });

    expect(h.usuarios.lockActiveEncargados).not.toHaveBeenCalled();
  });

  it('refuses to demote the last active encargado and writes nothing', async () => {
    const h = harness({ lockedIds: [TARGET_ID] });

    await expect(
      updateUsuario(h.uow, {
        id: TARGET_ID,
        cambios: { rol: 'deposito' },
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ENCARGADO', status: 409 });

    expect(h.usuarios.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('allows the demotion when another active encargado remains', async () => {
    const h = harness({ lockedIds: [TARGET_ID, OTHER_ENCARGADO_ID] });

    await updateUsuario(h.uow, {
      id: TARGET_ID,
      cambios: { rol: 'deposito' },
      actorId: ACTOR_ID,
    });

    expect(h.usuarios.update).toHaveBeenCalledWith(TARGET_ID, {
      rol: 'deposito',
    });
    expect(auditEvent(h.auditoria)).toMatchObject({
      accion: 'actualizar',
      usuarioId: ACTOR_ID,
    });
    // Changed fields ONLY (auditoria-general D6): nombre and email did not
    // move, so they belong in neither snapshot. These are toEqual, not
    // toMatchObject, deliberately — a subset match passes just as happily
    // on a snapshot carrying the whole row, which would file nombre and
    // email in the trail as if they had changed.
    expect(auditEvent(h.auditoria)?.datosPrevios).toEqual({
      rol: 'encargado',
    });
    expect(auditEvent(h.auditoria)?.datosPosteriores).toEqual({
      rol: 'deposito',
    });
  });

  it('raises USER_NOT_FOUND from the locked read', async () => {
    const h = harness({ previo: undefined });

    await expect(
      updateUsuario(h.uow, {
        id: TARGET_ID,
        cambios: { nombre: 'Nadie' },
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', status: 404 });
  });
});

describe('setUsuarioActivo', () => {
  it('refuses to deactivate the last active encargado and revokes no sessions', async () => {
    const h = harness({ lockedIds: [TARGET_ID] });

    await expect(
      setUsuarioActivo(h.uow, {
        id: TARGET_ID,
        activo: false,
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ENCARGADO', status: 409 });

    expect(h.usuarios.setActivo).not.toHaveBeenCalled();
    expect(h.sesiones.deleteAllForUser).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('deactivates, revokes every session, and files baja_logica', async () => {
    const h = harness({ lockedIds: [TARGET_ID, OTHER_ENCARGADO_ID] });

    await setUsuarioActivo(h.uow, {
      id: TARGET_ID,
      activo: false,
      actorId: ACTOR_ID,
    });

    expect(h.usuarios.setActivo).toHaveBeenCalledWith(TARGET_ID, false);
    // D10: without this a deactivated user's session rows are immortal —
    // purgeExpired runs only on login, which that user can never perform.
    expect(h.sesiones.deleteAllForUser).toHaveBeenCalledWith(TARGET_ID);
    expect(h.sesiones.deleteOthers).not.toHaveBeenCalled();
    expect(auditEvent(h.auditoria)).toMatchObject({ accion: 'baja_logica' });
    expect(auditEvent(h.auditoria)?.datosPrevios).toEqual({ activo: true });
    expect(auditEvent(h.auditoria)?.datosPosteriores).toEqual({
      activo: false,
    });
  });

  it('writes nothing when the user is already inactive, and never trips the guard', async () => {
    const h = harness({
      previo: usuarioResumen({ activo: false }),
      lockedIds: [],
    });

    const result = await setUsuarioActivo(h.uow, {
      id: TARGET_ID,
      activo: false,
      actorId: ACTOR_ID,
    });

    expect(result.activo).toBe(false);
    expect(h.usuarios.setActivo).not.toHaveBeenCalled();
    expect(h.sesiones.deleteAllForUser).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
    // The set lock IS still taken — D3 decides that from the request shape
    // before reading the target, deliberately over-locking rather than
    // inverting the lock order. What the already-inactive row changes is the
    // GUARD, which needs `previo.activo` and so never trips here.
    expect(h.usuarios.lockActiveEncargados).toHaveBeenCalled();
  });

  it('reactivates without taking the set lock and without revoking sessions', async () => {
    const h = harness({
      previo: usuarioResumen({ activo: false }),
      setActivoResult: usuarioResumen({ activo: true }),
    });

    await setUsuarioActivo(h.uow, {
      id: TARGET_ID,
      activo: true,
      actorId: ACTOR_ID,
    });

    expect(h.usuarios.lockActiveEncargados).not.toHaveBeenCalled();
    expect(h.sesiones.deleteAllForUser).not.toHaveBeenCalled();
    expect(auditEvent(h.auditoria)).toMatchObject({ accion: 'reactivar' });
    expect(auditEvent(h.auditoria)?.datosPrevios).toEqual({ activo: false });
    expect(auditEvent(h.auditoria)?.datosPosteriores).toEqual({
      activo: true,
    });
  });
});

describe('resetUsuarioPassword', () => {
  it('revokes every session, not just the others', async () => {
    const h = harness();

    await resetUsuarioPassword(h.uow, { id: TARGET_ID, actorId: ACTOR_ID });

    // D10's asymmetry with changePassword: the actor is a different
    // principal here, so there is no caller-owned session to preserve, and
    // the trigger is normally a lost or compromised credential.
    expect(h.sesiones.deleteAllForUser).toHaveBeenCalledWith(TARGET_ID);
    expect(h.sesiones.deleteOthers).not.toHaveBeenCalled();
  });

  it('files cambiar_password carrying the prior lockout state', async () => {
    const h = harness({
      previo: usuarioResumen({ debeCambiarPassword: false }),
    });

    await resetUsuarioPassword(h.uow, { id: TARGET_ID, actorId: ACTOR_ID });

    // D12: `bloqueadoHasta: <timestamp> → null` is the evidence that answers
    // "was this a rescue of a locked-out account, or an unexplained
    // credential change?" — the non-repudiation question ADR-0012 exists for.
    expect(auditEvent(h.auditoria)).toMatchObject({
      accion: 'cambiar_password',
      usuarioId: ACTOR_ID,
      entidadId: TARGET_ID,
      datosPrevios: {
        debeCambiarPassword: false,
        intentosFallidos: 3,
        bloqueadoHasta: new Date('2026-02-01T00:00:00.000Z'),
      },
      datosPosteriores: {
        debeCambiarPassword: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });
  });

  it('never takes the encargado set lock', async () => {
    const h = harness();

    await resetUsuarioPassword(h.uow, { id: TARGET_ID, actorId: ACTOR_ID });

    expect(h.usuarios.lockActiveEncargados).not.toHaveBeenCalled();
  });

  it('raises USER_NOT_FOUND from the locked read', async () => {
    const h = harness({ previo: undefined });

    await expect(
      resetUsuarioPassword(h.uow, { id: TARGET_ID, actorId: ACTOR_ID }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', status: 404 });
  });
});

describe('transaction discipline', () => {
  it('runs every mutating repo call of a create inside exactly one transaction', async () => {
    const h = harness();

    await createUsuario(h.uow, {
      nombre: 'Beto Deposito',
      email: 'beto@example.com',
      rol: 'deposito',
      actorId: ACTOR_ID,
    });

    expect(h.runCount.value).toBe(1);
    expect(h.calls).not.toHaveLength(0);
    expect(h.calls.every((call) => call.insideTransaction)).toBe(true);
  });

  it('runs the lock, the read, the write, the revocation and the audit of a deactivate inside one transaction', async () => {
    const h = harness({ lockedIds: [TARGET_ID, OTHER_ENCARGADO_ID] });

    await setUsuarioActivo(h.uow, {
      id: TARGET_ID,
      activo: false,
      actorId: ACTOR_ID,
    });

    expect(h.runCount.value).toBe(1);
    expect(h.calls.map((call) => call.method)).toEqual([
      'lockActiveEncargados',
      'findByIdForUpdate',
      'setActivo',
      'sesiones.deleteAllForUser',
      'auditoria.record',
    ]);
    expect(h.calls.every((call) => call.insideTransaction)).toBe(true);
  });
});
