import { describe, expect, it, vi } from 'vitest';
import type { Alerta, AlertasRepo } from '../alertas/repository.js';
import type {
  FiltroMovimientosPeriodo,
  Movimiento,
  MovimientosRepo,
} from '../movimientos/repository.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import {
  type ListarMovimientosPeriodoInput,
  type ReadRepos,
  listBajoMinimo,
  listDiscrepancias,
  listStockActual,
  listarMovimientosPeriodo,
} from './service.js';

const ACTOR_ENCARGADO_ID = '00000000-0000-4000-8000-0000000000e1';
const ACTOR_DEPOSITO_ID = '00000000-0000-4000-8000-0000000000d1';

function movimiento(over: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'mov-1',
    productoId: 'p1',
    tipo: 'entrada',
    cantidad: 1,
    motivo: null,
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: ACTOR_DEPOSITO_ID,
    fecha: new Date('2026-02-15T00:00:00.000Z'),
    ventaId: null,
    stockResultante: 1,
    ...over,
  };
}

function producto(over: Partial<Producto> = {}): Producto {
  return {
    id: 'p1',
    nombre: 'Producto Uno',
    sku: 'SKU-1',
    categoria: null,
    stockActual: 5,
    stockMinimo: null,
    precio: '10.00',
    proveedorId: 'prov-1',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function fakeRepos(
  overrides: {
    listByPeriodo?: MovimientosRepo['listByPeriodo'];
    findById?: ProductosRepo['findById'];
    list?: ProductosRepo['list'];
    bajoMinimo?: ProductosRepo['bajoMinimo'];
    alertasList?: AlertasRepo['list'];
  } = {},
): ReadRepos {
  return {
    movimientos: {
      listByPeriodo:
        overrides.listByPeriodo ?? (async () => ({ rows: [], total: 0 })),
    },
    productos: {
      findById: overrides.findById ?? (async () => producto()),
      list: overrides.list ?? (async () => ({ rows: [], total: 0 })),
      bajoMinimo:
        overrides.bajoMinimo ?? (async () => ({ rows: [], total: 0 })),
    },
    alertas: {
      create: async () => undefined,
      autoResolve: async () => undefined,
      manualResolve: async () => undefined,
      marcarVistas: async () => 0,
      findById: async () => undefined,
      list: overrides.alertasList ?? (async () => ({ rows: [], total: 0 })),
      countAbiertas: async () => 0,
      countAbiertasPorTipo: async () => 0,
    } as AlertasRepo,
  };
}

describe('listarMovimientosPeriodo', () => {
  it("forces usuarioId = actor.id into the repo call args when actor.rol === 'deposito', regardless of other input fields", async () => {
    const listByPeriodo = vi.fn(async (_filtro: FiltroMovimientosPeriodo) => ({
      rows: [],
      total: 0,
    }));
    const repos = fakeRepos({ listByPeriodo });
    const input: ListarMovimientosPeriodoInput = {
      fechaDesde: new Date('2026-02-01T00:00:00.000Z'),
      fechaHasta: new Date('2026-02-10T00:00:00.000Z'),
      page: 1,
      pageSize: 20,
      actor: { id: ACTOR_DEPOSITO_ID, rol: 'deposito' },
    };

    await listarMovimientosPeriodo(repos, input);

    expect(listByPeriodo).toHaveBeenCalledTimes(1);
    const filtro = listByPeriodo.mock.calls[0]?.[0] as FiltroMovimientosPeriodo;
    expect(filtro.usuarioId).toBe(ACTOR_DEPOSITO_ID);
  });

  it("passes usuarioId: undefined when actor.rol === 'encargado'", async () => {
    const listByPeriodo = vi.fn(async (_filtro: FiltroMovimientosPeriodo) => ({
      rows: [],
      total: 0,
    }));
    const repos = fakeRepos({ listByPeriodo });
    const input: ListarMovimientosPeriodoInput = {
      fechaDesde: new Date('2026-02-01T00:00:00.000Z'),
      fechaHasta: new Date('2026-02-10T00:00:00.000Z'),
      page: 1,
      pageSize: 20,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    };

    await listarMovimientosPeriodo(repos, input);

    const filtro = listByPeriodo.mock.calls[0]?.[0] as FiltroMovimientosPeriodo;
    expect(filtro.usuarioId).toBeUndefined();
  });

  it('converts a calendar-day-inclusive fechaHasta to a half-open fechaHastaExclusiva (+1 day) before it reaches the repo', async () => {
    const listByPeriodo = vi.fn(async (_filtro: FiltroMovimientosPeriodo) => ({
      rows: [],
      total: 0,
    }));
    const repos = fakeRepos({ listByPeriodo });
    const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
    const fechaHasta = new Date('2026-02-10T00:00:00.000Z');

    await listarMovimientosPeriodo(repos, {
      fechaDesde,
      fechaHasta,
      page: 1,
      pageSize: 20,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    const filtro = listByPeriodo.mock.calls[0]?.[0] as FiltroMovimientosPeriodo;
    expect(filtro.fechaDesde).toEqual(fechaDesde);
    expect(filtro.fechaHastaExclusiva).toEqual(
      new Date('2026-02-11T00:00:00.000Z'),
    );
  });

  it('resolves productoNombre per row via a per-distinct-producto findById call (D6 N+1 idiom, not a join)', async () => {
    const rows = [
      movimiento({ id: 'm1', productoId: 'p1' }),
      movimiento({ id: 'm2', productoId: 'p1' }),
      movimiento({ id: 'm3', productoId: 'p2' }),
    ];
    const listByPeriodo = vi.fn(async () => ({ rows, total: 3 }));
    const findById = vi.fn(async (id: string) =>
      producto({ id, nombre: id === 'p1' ? 'Producto Uno' : 'Producto Dos' }),
    );
    const repos = fakeRepos({ listByPeriodo, findById });

    const result = await listarMovimientosPeriodo(repos, {
      fechaDesde: new Date('2026-02-01T00:00:00.000Z'),
      fechaHasta: new Date('2026-02-10T00:00:00.000Z'),
      page: 1,
      pageSize: 20,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.productoNombre).toBe('Producto Uno');
    expect(result.rows[2]?.productoNombre).toBe('Producto Dos');
    // Two distinct productos across three rows — one lookup per row, per the
    // documented N+1 idiom (mirrors alertas/service.ts::listar).
    expect(findById).toHaveBeenCalledTimes(3);
  });

  it('falls back to an empty string when the producto no longer exists', async () => {
    const rows = [movimiento({ id: 'm1', productoId: 'gone' })];
    const listByPeriodo = vi.fn(async () => ({ rows, total: 1 }));
    const findById = vi.fn(async () => undefined);
    const repos = fakeRepos({ listByPeriodo, findById });

    const result = await listarMovimientosPeriodo(repos, {
      fechaDesde: new Date('2026-02-01T00:00:00.000Z'),
      fechaHasta: new Date('2026-02-10T00:00:00.000Z'),
      page: 1,
      pageSize: 20,
      actor: { id: ACTOR_ENCARGADO_ID, rol: 'encargado' },
    });

    expect(result.rows[0]?.productoNombre).toBe('');
  });
});

describe('listStockActual', () => {
  it('passes through to ProductosRepo.list() unmodified — no new query', async () => {
    const list = vi.fn(async () => ({ rows: [producto()], total: 1 }));
    const repos = fakeRepos({ list });

    const result = await listStockActual(repos, { page: 2, pageSize: 15 });

    expect(list).toHaveBeenCalledWith(2, 15);
    expect(result.total).toBe(1);
  });
});

describe('listBajoMinimo', () => {
  it("passes through to Phase 1's ProductosRepo.bajoMinimo", async () => {
    const bajoMinimo = vi.fn(async () => ({ rows: [producto()], total: 1 }));
    const repos = fakeRepos({ bajoMinimo });

    const result = await listBajoMinimo(repos, { page: 1, pageSize: 20 });

    expect(bajoMinimo).toHaveBeenCalledWith(1, 20);
    expect(result.total).toBe(1);
  });
});

describe('listDiscrepancias', () => {
  it("calls alertas/service.ts::listar with filtro.tipo = 'discrepancia'", async () => {
    const alerta: Alerta = {
      id: 'a1',
      productoId: 'p1',
      tipo: 'discrepancia',
      estado: 'activa',
      movimientoId: null,
      creadaEn: new Date('2026-02-01T00:00:00.000Z'),
      resueltaEn: null,
      resueltaPor: null,
    };
    const alertasList = vi.fn(async () => ({ rows: [alerta], total: 1 }));
    const repos = fakeRepos({ alertasList });

    const result = await listDiscrepancias(repos, { page: 1, pageSize: 20 });

    expect(alertasList).toHaveBeenCalledWith({ tipo: 'discrepancia' }, 1, 20);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.productoNombre).toBe('Producto Uno');
  });
});
