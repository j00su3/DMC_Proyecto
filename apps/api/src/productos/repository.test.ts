import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { productos } from '../db/schema.js';
import { DrizzleProductosRepo } from './repository.js';

// backlog #9 (anulacion-venta) tasks.md 2.1/2.2. Unit-level (fake
// executor): proves the query builder's WHERE condition is exactly
// `eq(productos.id, id)` — no `activo` predicate composed in, unlike
// `aplicarDelta`'s `and(eq(id), eq(activo, true), ...)`. This is the
// A8-exemption's compile-shape property; the concurrency/atomicity
// properties (real stock reversal, activo=false unblocked) live in the
// integration suite (design.md's Testing Strategy row, tasks.md 5.1).
describe('revertirStockPorAnulacion — A8-exempt (no activo predicate)', () => {
  it("issues an UPDATE whose WHERE is exactly eq(productos.id, id) — no 'and', no activo", async () => {
    const returning = vi.fn(async () => [{ stockActual: 15 }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleProductosRepo(db);
    const result = await repo.revertirStockPorAnulacion('producto-1', 5);

    expect(result).toBe(15);
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith(eq(productos.id, 'producto-1'));
  });

  it('reverts stock by the exact positive cantidad passed in', async () => {
    const returning = vi.fn(async () => [{ stockActual: 42 }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleProductosRepo(db);
    const result = await repo.revertirStockPorAnulacion('producto-2', 7);

    expect(result).toBe(42);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('throws if the row vanished (impossible behind the items_venta FK, but proves the expectOneRow idiom)', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleProductosRepo(db);

    await expect(
      repo.revertirStockPorAnulacion('producto-missing', 1),
    ).rejects.toThrow(/no row returned/);
  });
});
