import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client.js';
import { pagos, ventas } from '../db/schema.js';
import { DrizzleVentasRepo } from './repository.js';

// backlog #9 (anulacion-venta) tasks.md 2.3/2.4. Unit-level (fake
// executor), mirroring productos/repository.test.ts's precedent: proves the
// conditional-UPDATE shape (WHERE id AND estado = 'confirmada') and the
// undefined-on-zero-rows classification seam. The real serialization/race
// behavior lives in the integration suite (tasks.md 5.2).
describe('marcarAnulada — conditional UPDATE (design.md serialization point)', () => {
  it('returns the updated row when the WHERE guard matches (estado = confirmada)', async () => {
    const anuladaRow = {
      id: 'venta-1',
      numeroCorrelativo: 1,
      usuarioId: 'u1',
      estado: 'anulada',
      total: '10.00',
      creadoEn: new Date('2026-01-01T00:00:00.000Z'),
      anuladaPor: 'encargado-1',
      anuladaEn: new Date('2026-01-02T00:00:00.000Z'),
      motivoAnulacion: 'Cliente canceló el pedido',
    };
    const returning = vi.fn(async () => [anuladaRow]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleVentasRepo(db);
    const result = await repo.marcarAnulada({
      ventaId: 'venta-1',
      anuladaPor: 'encargado-1',
      motivoAnulacion: 'Cliente canceló el pedido',
    });

    expect(result).toEqual(anuladaRow);
    expect(where).toHaveBeenCalledWith(
      and(eq(ventas.id, 'venta-1'), eq(ventas.estado, 'confirmada')),
    );
  });

  it('returns undefined when the row does not satisfy the guard (already anulada or missing)', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleVentasRepo(db);
    const result = await repo.marcarAnulada({
      ventaId: 'venta-already-anulada',
      anuladaPor: 'encargado-1',
      motivoAnulacion: 'Motivo cualquiera',
    });

    expect(result).toBeUndefined();
  });
});

describe('revertirPagos — moves every registrado pago to revertido', () => {
  it('issues an UPDATE scoped to ventaId AND estado = registrado, returning every moved row', async () => {
    const revertidos = [
      {
        id: 'pago-1',
        ventaId: 'venta-1',
        medio: 'efectivo',
        monto: '10.00',
        vuelto: '0',
        estado: 'revertido',
      },
    ];
    const returning = vi.fn(async () => revertidos);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleVentasRepo(db);
    const result = await repo.revertirPagos('venta-1');

    expect(result).toEqual(revertidos);
    expect(where).toHaveBeenCalledWith(
      and(eq(pagos.ventaId, 'venta-1'), eq(pagos.estado, 'registrado')),
    );
    expect(set).toHaveBeenCalledWith({ estado: 'revertido' });
  });

  it('returns an empty array when there is nothing left to revert', async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const db = { update } as unknown as DbExecutor;

    const repo = new DrizzleVentasRepo(db);
    const result = await repo.revertirPagos('venta-2');

    expect(result).toEqual([]);
  });
});
