import { describe, expect, it, vi } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
import type { Movimiento, MovimientosRepo } from '../movimientos/repository.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';
import { type ReadRepos, obtenerResumen } from './service.js';

function movimiento(over: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'mov-1',
    productoId: 'p1',
    tipo: 'entrada',
    cantidad: 1,
    motivo: null,
    esDiscrepancia: false,
    esMerma: false,
    usuarioId: 'u1',
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
    countAbiertasPorTipo?: AlertasRepo['countAbiertasPorTipo'];
    countAbiertas?: AlertasRepo['countAbiertas'];
    listRecientes?: MovimientosRepo['listRecientes'];
    findById?: ProductosRepo['findById'];
  } = {},
): ReadRepos {
  return {
    alertas: {
      countAbiertasPorTipo: overrides.countAbiertasPorTipo ?? (async () => 0),
      countAbiertas: overrides.countAbiertas ?? (async () => 0),
    },
    movimientos: {
      listRecientes: overrides.listRecientes ?? (async () => []),
    },
    productos: {
      findById: overrides.findById ?? (async () => producto()),
    },
  };
}

describe('obtenerResumen', () => {
  it("calls countAbiertasPorTipo('quiebre'), countAbiertasPorTipo('stock_bajo'), countAbiertas(), and listRecientes(10) via Promise.all", async () => {
    const countAbiertasPorTipo = vi.fn(async () => 0);
    const countAbiertas = vi.fn(async () => 0);
    const listRecientes = vi.fn(async () => []);
    const repos = fakeRepos({
      countAbiertasPorTipo,
      countAbiertas,
      listRecientes,
    });

    await obtenerResumen(repos);

    expect(countAbiertasPorTipo).toHaveBeenCalledWith('quiebre');
    expect(countAbiertasPorTipo).toHaveBeenCalledWith('stock_bajo');
    expect(countAbiertasPorTipo).toHaveBeenCalledTimes(2);
    expect(countAbiertas).toHaveBeenCalledWith();
    expect(listRecientes).toHaveBeenCalledWith(10);
  });

  it('composes the exact dashboardResumenDto shape', async () => {
    const repos = fakeRepos({
      countAbiertasPorTipo: vi.fn(async (tipo) => (tipo === 'quiebre' ? 2 : 3)),
      countAbiertas: async () => 7,
      listRecientes: async () => [movimiento()],
    });

    const result = await obtenerResumen(repos);

    expect(result).toEqual({
      quiebres: 2,
      stockBajo: 3,
      alertasActivas: 7,
      actividadReciente: [
        {
          id: 'mov-1',
          productoId: 'p1',
          productoNombre: 'Producto Uno',
          tipo: 'entrada',
          fecha: new Date('2026-02-15T00:00:00.000Z'),
          usuarioId: 'u1',
        },
      ],
    });
  });

  it('resolves productoNombre per row via a per-row findById call (D1, D6 N+1 idiom)', async () => {
    const rows = [
      movimiento({ id: 'm1', productoId: 'p1' }),
      movimiento({ id: 'm2', productoId: 'p2' }),
    ];
    const findById = vi.fn(async (id: string) =>
      producto({ id, nombre: id === 'p1' ? 'Producto Uno' : 'Producto Dos' }),
    );
    const repos = fakeRepos({
      listRecientes: async () => rows,
      findById,
    });

    const result = await obtenerResumen(repos);

    expect(result.actividadReciente[0]?.productoNombre).toBe('Producto Uno');
    expect(result.actividadReciente[1]?.productoNombre).toBe('Producto Dos');
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('falls back to an empty string productoNombre when the producto no longer exists (D6, activo=false case — no special-casing)', async () => {
    const repos = fakeRepos({
      listRecientes: async () => [movimiento({ productoId: 'gone' })],
      findById: async () => undefined,
    });

    const result = await obtenerResumen(repos);

    expect(result.actividadReciente[0]?.productoNombre).toBe('');
  });

  it('returns actividadReciente: [] when listRecientes returns no rows, not an error', async () => {
    const repos = fakeRepos({ listRecientes: async () => [] });

    const result = await obtenerResumen(repos);

    expect(result.actividadReciente).toEqual([]);
  });
});
