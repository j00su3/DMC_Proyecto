import { inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { proveedores } from '../db/schema.js';
import { DrizzleProveedoresRepo } from './repository.js';

// auditoria-lectura design.md D3: narrow projection for the audit
// enrichment read path — {id, nombre} only, one inArray SELECT.
describe('DrizzleProveedoresRepo.findManyByIds (D3)', () => {
  it('returns only {id, nombre}', async () => {
    const rows = [{ id: 'proveedor-1', nombre: 'Harina SA' }];
    const where = vi.fn(async () => rows);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleProveedoresRepo(db);
    const result = await repo.findManyByIds(['proveedor-1']);

    expect(result).toEqual(rows);
    expect(where).toHaveBeenCalledWith(
      inArray(proveedores.id, ['proveedor-1']),
    );
  });

  it('returns an empty array for an empty id list, without querying', async () => {
    const select = vi.fn();
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleProveedoresRepo(db);
    const result = await repo.findManyByIds([]);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
