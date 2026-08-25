import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { DrizzleSesionesRepo, DrizzleUsuariosRepo } from './repository.js';

// Interface-shape tests only: assert the repos expose the contracted
// methods and delegate to the injected Db's query-builder entry points.
// Real SQL/lockout semantics are integration-only (repository.integration.test.ts)
// since the atomic UPDATE's CASE-branch evaluation order is Postgres-specific.
function createFakeDb() {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => []),
    insert: vi.fn(() => chain),
    values: vi.fn(async () => undefined),
    update: vi.fn(() => chain),
    set: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    execute: vi.fn(async () => ({
      rows: [{ intentos_fallidos: 1, bloqueado_hasta: null }],
    })),
  };
  return { db: chain as unknown as Db, chain };
}

describe('DrizzleUsuariosRepo', () => {
  it('exposes findByEmail, registerFailedAttempt, resetAttempts over an injected Db', async () => {
    const { db } = createFakeDb();
    const repo = new DrizzleUsuariosRepo(db);

    expect(typeof repo.findByEmail).toBe('function');
    expect(typeof repo.registerFailedAttempt).toBe('function');
    expect(typeof repo.resetAttempts).toBe('function');

    await repo.findByEmail('a@b.com');
    expect(db.select).toHaveBeenCalled();

    const result = await repo.registerFailedAttempt('id-1');
    expect(db.execute).toHaveBeenCalled();
    expect(result).toEqual({ intentosFallidos: 1, bloqueadoHasta: null });

    await repo.resetAttempts('id-1');
    expect(db.update).toHaveBeenCalled();
  });

  it('updatePassword sets the hash and clears debe_cambiar_password in one UPDATE (D6)', async () => {
    const { db, chain } = createFakeDb();
    const repo = new DrizzleUsuariosRepo(db);

    await repo.updatePassword('id-1', 'new-hash');

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(chain.set).toHaveBeenCalledWith({
      hashContrasena: 'new-hash',
      debeCambiarPassword: false,
    });
  });
});

describe('DrizzleSesionesRepo', () => {
  it('exposes create, findValid, delete, purgeExpired over an injected Db', async () => {
    const { db } = createFakeDb();
    const repo = new DrizzleSesionesRepo(db);

    expect(typeof repo.create).toBe('function');
    expect(typeof repo.findValid).toBe('function');
    expect(typeof repo.delete).toBe('function');
    expect(typeof repo.purgeExpired).toBe('function');

    await repo.create({ id: 'tok', usuarioId: 'u1', expiraEn: new Date() });
    expect(db.insert).toHaveBeenCalled();

    await repo.findValid('tok', new Date());
    expect(db.select).toHaveBeenCalled();

    await repo.delete('tok');
    expect(db.delete).toHaveBeenCalled();

    await repo.purgeExpired('u1');
    expect(db.delete).toHaveBeenCalled();
  });

  it('deleteOthers deletes only the given user sessions except the excepted one', async () => {
    const { db, chain } = createFakeDb();
    const repo = new DrizzleSesionesRepo(db);

    await repo.deleteOthers('u1', 'keep-me');

    expect(db.delete).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
  });
});
