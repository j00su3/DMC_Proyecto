import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { usuarios } from '../db/schema.js';
import { DrizzleUsuariosRepo } from './repository.js';

// auditoria-lectura design.md D3: a narrow projection, never the full row —
// hashContrasena must never leave the database on this read path. This RED
// test asserts the absence of the key, not merely that it is falsy.
describe('DrizzleUsuariosRepo.findManyByIds (D3)', () => {
  it('returns only {id, nombre} — no hashContrasena key at all', async () => {
    const rows = [{ id: 'usuario-1', nombre: 'Ana' }];
    const where = vi.fn(async () => rows);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleUsuariosRepo(db);
    const result = await repo.findManyByIds(['usuario-1']);

    expect(result).toEqual(rows);
    expect(result[0]).not.toHaveProperty('hashContrasena');
    expect(where).toHaveBeenCalledWith(inArray(usuarios.id, ['usuario-1']));
    // The fake returns fixture rows regardless of the projection, so the
    // assertions above cannot see it. This one pins what is actually asked of
    // the database: {id, nombre} and nothing else — never the full row, which
    // would read hashContrasena.
    expect(select).toHaveBeenCalledWith({
      id: usuarios.id,
      nombre: usuarios.nombre,
    });
  });

  it('returns an empty array for an empty id list, without querying', async () => {
    const select = vi.fn();
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleUsuariosRepo(db);
    const result = await repo.findManyByIds([]);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});

// rescate-encargado D5: an informational read. Plain SELECT with no row lock
// (so it works under a read-only role) and the same predicate as the guard:
// rol = 'encargado' AND activo. The real-DB count is proven in PR 2.
describe('DrizzleUsuariosRepo.countActiveEncargados (D5)', () => {
  it('counts active encargados with a plain SELECT and returns the number', async () => {
    const where = vi.fn(async () => [{ n: 2 }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleUsuariosRepo(db);
    const result = await repo.countActiveEncargados();

    expect(result).toBe(2);
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(usuarios);
    expect(where).toHaveBeenCalledWith(
      and(eq(usuarios.rol, 'encargado'), eq(usuarios.activo, true)),
    );
  });

  it('never takes a row lock: the query chain ends at where()', async () => {
    // `.for('update')` does not exist on this fake, so any attempt to lock
    // would throw instead of resolving.
    const where = vi.fn(async () => [{ n: 0 }]);
    const db = {
      select: () => ({ from: () => ({ where }) }),
    } as unknown as DbExecutor;

    const repo = new DrizzleUsuariosRepo(db);

    await expect(repo.countActiveEncargados()).resolves.toBe(0);
  });
});
