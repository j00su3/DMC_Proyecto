import { inArray } from 'drizzle-orm';
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
