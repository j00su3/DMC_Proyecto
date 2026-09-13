import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { auditoria } from '../db/schema.js';
import { DrizzleAuditoriaRepo } from './repository.js';

const fakeRow = {
  id: 'audit-1',
  entidad: 'productos' as const,
  entidadId: 'producto-1',
  accion: 'actualizar' as const,
  usuarioId: 'usuario-1',
  datosPrevios: { nombre: 'antes' },
  datosPosteriores: { nombre: 'despues' },
  creadoEn: new Date('2026-09-02T00:00:00.000Z'),
};

// design.md D1: the SAME and()-composed condition object must reach BOTH the
// page query and the count query — this codebase's documented recurring
// defect class (alertas/repository.ts:159-164, proveedores/repository.ts D9,
// productos/repository.ts D7/D11).
describe('DrizzleAuditoriaRepo.list (D1)', () => {
  it('applies the identical composed condition object to both the page query and the count query', async () => {
    const rows = [fakeRow];
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

    const repo = new DrizzleAuditoriaRepo(db);
    const result = await repo.list(
      {
        entidad: 'productos',
        entidadId: 'producto-1',
        usuarioId: 'usuario-1',
      },
      1,
      20,
    );

    const expectedCondition = and(
      eq(auditoria.entidad, 'productos'),
      eq(auditoria.entidadId, 'producto-1'),
      eq(auditoria.usuarioId, 'usuario-1'),
    );
    expect(result).toEqual({ rows, total: 1 });
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);

    // Mutation guard: the two calls must have received the exact SAME
    // object reference, not merely a deep-equal reconstruction — deriving
    // the condition twice (once per query) is D1's named trap and would
    // still pass the toHaveBeenCalledWith assertions above.
    expect(pageWhere.mock.calls[0]?.[0]).toBe(countWhere.mock.calls[0]?.[0]);
  });

  it('orders by desc(creadoEn), desc(id) — the id tiebreaker for same-transaction rows', async () => {
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

    const repo = new DrizzleAuditoriaRepo(db);
    await repo.list({}, 1, 20);

    expect(orderBy).toHaveBeenCalledWith(
      desc(auditoria.creadoEn),
      desc(auditoria.id),
    );
  });

  it('composes only the supplied filter, leaving the others undefined in the and()', async () => {
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

    const repo = new DrizzleAuditoriaRepo(db);
    await repo.list({ usuarioId: 'usuario-1' }, 1, 20);

    const expectedCondition = and(
      undefined,
      undefined,
      eq(auditoria.usuarioId, 'usuario-1'),
    );
    expect(pageWhere).toHaveBeenCalledWith(expectedCondition);
    expect(countWhere).toHaveBeenCalledWith(expectedCondition);
  });

  it('paginates with the given page/pageSize (limit/offset)', async () => {
    const rows = [fakeRow];
    const offset = vi.fn(async () => rows);
    const limit = vi.fn(() => ({ offset }));
    const orderBy = vi.fn(() => ({ limit }));
    const pageWhere = vi.fn(() => ({ orderBy }));
    const countWhere = vi.fn(async () => [{ total: 55 }]);
    const from = vi
      .fn()
      .mockReturnValueOnce({ where: pageWhere })
      .mockReturnValueOnce({ where: countWhere });
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as DbExecutor;

    const repo = new DrizzleAuditoriaRepo(db);
    const result = await repo.list({}, 3, 10);

    expect(result.total).toBe(55);
    expect(limit).toHaveBeenCalledWith(10);
    expect(offset).toHaveBeenCalledWith(20);
  });
});
