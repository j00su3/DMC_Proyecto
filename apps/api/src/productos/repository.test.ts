import { and, eq, isNotNull, lte } from 'drizzle-orm';
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

// backlog #12 (reportes) design.md D1, tasks.md task 1.1. Unit-level (fake
// executor), mirroring alertas/repository.test.ts's D9 `list` pattern:
// proves the WHERE condition's exact shape, not the real filtering — that
// SQL-level property (equal-to-threshold included, real Postgres NULL
// semantics) is proven by the integration suite. The condition built here
// structurally encodes both spec scenarios at once: `lte` is inclusive of
// `stockActual === stockMinimo` (spec "Product exactly at threshold is
// included"), and `isNotNull` excludes a null stockMinimo regardless of
// stockActual (spec "Null stock mínimo is excluded") — this is this file's
// own D7/D11 trap: applying the condition to only one of the two queries
// makes `data.length` look right while `total` is silently wrong.
describe('bajoMinimo (D1)', () => {
  const expectedCondition = and(
    lte(productos.stockActual, productos.stockMinimo),
    isNotNull(productos.stockMinimo),
  );

  it('applies the identical stockActual<=stockMinimo AND stockMinimo IS NOT NULL condition to both the page query and the count query', async () => {
    const rows = [{ id: 'producto-1' }];
    const offset = vi.fn(async () => rows);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const pageWhere = vi.fn(() => ({ orderBy }));
    const countWhere = vi.fn(async () => [{ total: 1 }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ where: pageWhere })
      .mockReturnValueOnce({ where: countWhere });
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleProductosRepo(db);
    const result = await repo.bajoMinimo(1, 20);

    expect(result).toEqual({ rows, total: 1 });
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);
  });

  it('orders by asc(stockActual), asc(id) — most-depleted first, deterministic tie-break', async () => {
    const offset = vi.fn(async () => []);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const pageWhere = vi.fn(() => ({ orderBy }));
    const countWhere = vi.fn(async () => [{ total: 0 }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ where: pageWhere })
      .mockReturnValueOnce({ where: countWhere });
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleProductosRepo(db);
    await repo.bajoMinimo(1, 20);

    expect(orderBy).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({}),
    );
    expect(orderBy).toHaveBeenCalledTimes(1);
  });

  it("total reflects the filtered count, not the unfiltered total, and stays consistent across pages (spec 'Bajo mínimo total matches the filtered count')", async () => {
    const rows = [
      { id: 'producto-1' },
      { id: 'producto-2' },
      { id: 'producto-3' },
    ];
    const offsetPage1 = vi.fn(async () => rows.slice(0, 2));
    const limitPage1 = vi.fn(() => ({ offset: offsetPage1 }));
    const orderByPage1 = vi.fn(() => ({ limit: limitPage1 }));
    const pageWherePage1 = vi.fn(() => ({ orderBy: orderByPage1 }));
    const countWherePage1 = vi.fn(async () => [{ total: 3 }]);
    const fromPage1 = vi
      .fn()
      .mockReturnValueOnce({ where: pageWherePage1 })
      .mockReturnValueOnce({ where: countWherePage1 });
    const selectPage1 = vi.fn(() => ({ from: fromPage1 }));
    const dbPage1 = { select: selectPage1 } as unknown as DbExecutor;

    const repoPage1 = new DrizzleProductosRepo(dbPage1);
    const page1 = await repoPage1.bajoMinimo(1, 2);

    const offsetPage2 = vi.fn(async () => rows.slice(2));
    const limitPage2 = vi.fn(() => ({ offset: offsetPage2 }));
    const orderByPage2 = vi.fn(() => ({ limit: limitPage2 }));
    const pageWherePage2 = vi.fn(() => ({ orderBy: orderByPage2 }));
    const countWherePage2 = vi.fn(async () => [{ total: 3 }]);
    const fromPage2 = vi
      .fn()
      .mockReturnValueOnce({ where: pageWherePage2 })
      .mockReturnValueOnce({ where: countWherePage2 });
    const selectPage2 = vi.fn(() => ({ from: fromPage2 }));
    const dbPage2 = { select: selectPage2 } as unknown as DbExecutor;

    const repoPage2 = new DrizzleProductosRepo(dbPage2);
    const page2 = await repoPage2.bajoMinimo(2, 2);

    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
  });
});
