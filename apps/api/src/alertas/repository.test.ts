import { and, eq, ne } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { alertas } from '../db/schema.js';
import { DrizzleAlertasRepo } from './repository.js';

const fakeAlerta = {
  id: 'alerta-1',
  productoId: 'producto-1',
  movimientoId: 'movimiento-1',
  tipo: 'stock_bajo' as const,
  estado: 'activa' as const,
  creadaEn: new Date('2026-09-02T00:00:00.000Z'),
  resueltaEn: null,
  resueltaPor: null,
};

describe('DrizzleAlertasRepo.create — D4 dedup', () => {
  it('returns the created Alerta on success', async () => {
    const returning = vi.fn(async () => [fakeAlerta]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.create({
      productoId: 'producto-1',
      tipo: 'stock_bajo',
      movimientoId: 'movimiento-1',
    });

    expect(result).toEqual(fakeAlerta);
    expect(insert).toHaveBeenCalledWith(alertas);
  });

  it('returns undefined when an open alert already exists for the same producto+tipo (ON CONFLICT DO NOTHING)', async () => {
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
    const db = { insert } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.create({
      productoId: 'producto-1',
      tipo: 'stock_bajo',
      movimientoId: 'movimiento-1',
    });

    expect(result).toBeUndefined();
    expect(onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [alertas.productoId, alertas.tipo],
      }),
    );
  });
});

describe('DrizzleAlertasRepo.autoResolve', () => {
  it("sets estado='resuelta' and resuelta_por=null, and issues WHERE producto_id + tipo + not-already-resuelta", async () => {
    const resolved = { ...fakeAlerta, estado: 'resuelta' as const };
    const returning = vi.fn(async () => [resolved]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.autoResolve('producto-1', 'stock_bajo');

    expect(result).toEqual(resolved);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'resuelta', resueltaPor: null }),
    );
    expect(where).toHaveBeenCalledWith(
      and(
        eq(alertas.productoId, 'producto-1'),
        eq(alertas.tipo, 'stock_bajo'),
        ne(alertas.estado, 'resuelta'),
      ),
    );
  });

  it('returns undefined when no open alert of that tipo exists for the producto', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.autoResolve('producto-1', 'quiebre');

    expect(result).toBeUndefined();
  });
});

describe('DrizzleAlertasRepo.manualResolve', () => {
  it('sets resuelta_por to the resolving user id', async () => {
    const resolved = {
      ...fakeAlerta,
      tipo: 'discrepancia' as const,
      estado: 'resuelta' as const,
      resueltaPor: 'usuario-1',
    };
    const returning = vi.fn(async () => [resolved]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.manualResolve('alerta-1', 'usuario-1');

    expect(result).toEqual(resolved);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: 'resuelta',
        resueltaPor: 'usuario-1',
      }),
    );
  });

  it('returns undefined when there is no OPEN alert with that id', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.manualResolve('alerta-missing', 'usuario-1');

    expect(result).toBeUndefined();
  });
});

describe('DrizzleAlertasRepo.marcarVistas', () => {
  it("transitions every 'activa' row to 'vista' and returns the count transitioned", async () => {
    const returning = vi.fn(async () => [
      { id: 'a1' },
      { id: 'a2' },
      { id: 'a3' },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.marcarVistas();

    expect(result).toBe(3);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'vista' }),
    );
    expect(where).toHaveBeenCalledWith(eq(alertas.estado, 'activa'));
  });

  it('returns 0 when there is nothing activa to transition', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.marcarVistas();

    expect(result).toBe(0);
  });
});

describe('DrizzleAlertasRepo.list', () => {
  it('applies the FiltroAlertas.estado predicate to both the page query and the count query', async () => {
    const rows = [fakeAlerta];
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

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.list({ estado: 'activa' }, 1, 20);

    // D4 (backlog #12) widened this from a bare ternary to and(estado?,
    // tipo?) — an undefined tipo still composes into the and() call, so the
    // expected condition here must match and()'s own shape, not a bare eq().
    const expectedCondition = and(eq(alertas.estado, 'activa'), undefined);
    expect(result).toEqual({ rows, total: 1 });
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);
  });

  it('paginates with the given page/pageSize (limit/offset)', async () => {
    const rows = [fakeAlerta];
    const offset = vi.fn(async () => rows);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const pageWhere = vi.fn(() => ({ orderBy }));
    const countWhere = vi.fn(async () => [{ total: 42 }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ where: pageWhere })
      .mockReturnValueOnce({ where: countWhere });
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.list({}, 3, 10);

    expect(result.total).toBe(42);
    expect(limit).toHaveBeenCalledWith(10);
    expect(offset).toHaveBeenCalledWith(20);
  });
});

// backlog #12 (reportes) design.md D4, tasks.md task 1.4: FiltroAlertas
// widening — extends this file's own D9 precedent (the estado predicate
// applied identically to both the page and the count query) to a second,
// composable field.
describe('DrizzleAlertasRepo.list — FiltroAlertas.tipo (D4)', () => {
  it('applies the tipo predicate to both the page query and the count query', async () => {
    const rows = [{ ...fakeAlerta, tipo: 'discrepancia' as const }];
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

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.list({ tipo: 'discrepancia' }, 1, 20);

    const expectedCondition = and(undefined, eq(alertas.tipo, 'discrepancia'));
    expect(result).toEqual({ rows, total: 1 });
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);
  });

  it('composes estado + tipo into one AND condition applied identically to page and count query', async () => {
    const rows = [
      {
        ...fakeAlerta,
        tipo: 'discrepancia' as const,
        estado: 'activa' as const,
      },
    ];
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

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.list(
      { estado: 'activa', tipo: 'discrepancia' },
      1,
      20,
    );

    const expectedCondition = and(
      eq(alertas.estado, 'activa'),
      eq(alertas.tipo, 'discrepancia'),
    );
    expect(result).toEqual({ rows, total: 1 });
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);
  });

  it('returns only matching rows when filtered by tipo alone, leaving other alertas out of data and total', async () => {
    const rows = [{ ...fakeAlerta, tipo: 'discrepancia' as const }];
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

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.list({ tipo: 'discrepancia' }, 1, 20);

    expect(result.rows).toEqual(rows);
    expect(result.total).toBe(1);
  });
});

describe('DrizzleAlertasRepo.countAbiertas', () => {
  it('counts every non-resuelta row', async () => {
    const where = vi.fn(async () => [{ total: 7 }]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.countAbiertas();

    expect(result).toBe(7);
    expect(where).toHaveBeenCalledWith(ne(alertas.estado, 'resuelta'));
  });
});

describe('DrizzleAlertasRepo.findById', () => {
  it('returns the row when found', async () => {
    const limit = vi.fn(async () => [fakeAlerta]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.findById('alerta-1');

    expect(result).toEqual(fakeAlerta);
    expect(where).toHaveBeenCalledWith(eq(alertas.id, 'alerta-1'));
  });

  it('returns undefined when not found', async () => {
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleAlertasRepo(db);
    const result = await repo.findById('missing');

    expect(result).toBeUndefined();
  });
});
