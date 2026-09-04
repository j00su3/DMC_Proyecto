import { describe, expect, it, vi } from 'vitest';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { TxControl, UnitOfWork } from '../db/uow.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { Alerta, AlertasRepo } from './repository.js';
import { contarAbiertas, listar, marcarVistas, resolver } from './service.js';

function makeAlerta(overrides: Partial<Alerta> = {}): Alerta {
  return {
    id: 'alerta-1',
    productoId: 'producto-1',
    tipo: 'discrepancia',
    estado: 'activa',
    movimientoId: 'movimiento-1',
    creadaEn: new Date('2026-09-02T00:00:00.000Z'),
    resueltaEn: null,
    resueltaPor: null,
    ...overrides,
  };
}

function fakeAlertasRepo(overrides: Partial<AlertasRepo> = {}): AlertasRepo {
  return {
    create: async () => makeAlerta(),
    autoResolve: async () => makeAlerta(),
    manualResolve: async () => makeAlerta({ estado: 'resuelta' }),
    marcarVistas: async () => 0,
    findById: async () => makeAlerta(),
    list: async () => ({ rows: [], total: 0 }),
    countAbiertas: async () => 0,
    countAbiertasPorTipo: async () => 0,
    ...overrides,
  };
}

function fakeUow(
  alertas: AlertasRepo,
  auditoria: Partial<AuditoriaRepo> = {},
): UnitOfWork {
  const repos = {
    alertas,
    auditoria: { record: async () => {}, ...auditoria } as AuditoriaRepo,
  };
  return {
    async run(work) {
      const tx: TxControl = { savepoint: async (_name, fn) => fn() };
      return work(repos as never, tx);
    },
  };
}

describe('listar', () => {
  it('resolves each row producto name via productos.findById (D6 N+1)', async () => {
    const alertas = fakeAlertasRepo({
      list: async () => ({
        rows: [
          makeAlerta({ id: 'a1', productoId: 'p1' }),
          makeAlerta({ id: 'a2', productoId: 'p2' }),
        ],
        total: 2,
      }),
    });
    const productos = {
      findById: vi.fn(async (id: string) =>
        id === 'p1'
          ? ({ nombre: 'Producto Uno' } as never)
          : ({ nombre: 'Producto Dos' } as never),
      ),
    } as unknown as Pick<ProductosRepo, 'findById'>;

    const result = await listar(
      { alertas, productos },
      { filtro: {}, page: 1, pageSize: 20 },
    );

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.productoNombre).toBe('Producto Uno');
    expect(result.rows[1]?.productoNombre).toBe('Producto Dos');
    expect(productos.findById).toHaveBeenCalledTimes(2);
  });

  it('falls back to an empty string when the producto no longer exists', async () => {
    const alertas = fakeAlertasRepo({
      list: async () => ({
        rows: [makeAlerta({ productoId: 'gone' })],
        total: 1,
      }),
    });
    const productos = {
      findById: async () => undefined,
    } as unknown as Pick<ProductosRepo, 'findById'>;

    const result = await listar(
      { alertas, productos },
      { filtro: {}, page: 1, pageSize: 20 },
    );

    expect(result.rows[0]?.productoNombre).toBe('');
  });
});

describe('contarAbiertas', () => {
  it('returns the repo count verbatim', async () => {
    const alertas = fakeAlertasRepo({ countAbiertas: async () => 3 });
    const result = await contarAbiertas({ alertas });
    expect(result).toBe(3);
  });
});

describe('marcarVistas', () => {
  it('returns the number of rows transitioned, no audit call needed', async () => {
    const alertas = fakeAlertasRepo({ marcarVistas: async () => 5 });
    const result = await marcarVistas({ alertas });
    expect(result).toBe(5);
  });
});

describe('resolver', () => {
  it('resolves an activa discrepancia and audits the resolution', async () => {
    const recordAudit = vi.fn(async () => {});
    const alertas = fakeAlertasRepo({
      findById: async () =>
        makeAlerta({ tipo: 'discrepancia', estado: 'activa' }),
      manualResolve: async (id, resueltaPor) =>
        makeAlerta({ id, estado: 'resuelta', resueltaPor }),
    });
    const uow = fakeUow(alertas, { record: recordAudit });

    const result = await resolver(uow, { id: 'alerta-1', actorId: 'user-1' });

    expect(result.estado).toBe('resuelta');
    expect(result.resueltaPor).toBe('user-1');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'alertas',
        accion: 'actualizar',
        usuarioId: 'user-1',
      }),
    );
  });

  it('throws ALERT_NOT_FOUND for an id with no row at all', async () => {
    const alertas = fakeAlertasRepo({ findById: async () => undefined });
    const uow = fakeUow(alertas);

    await expect(
      resolver(uow, { id: 'missing', actorId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
  });

  it('throws ALERT_ALREADY_RESOLVED for an already-resuelta alert', async () => {
    const alertas = fakeAlertasRepo({
      findById: async () => makeAlerta({ estado: 'resuelta' }),
    });
    const uow = fakeUow(alertas);

    await expect(
      resolver(uow, { id: 'alerta-1', actorId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ALERT_ALREADY_RESOLVED' });
  });

  it('throws ALERT_NOT_MANUALLY_RESOLVABLE for an activa stock_bajo alert', async () => {
    const alertas = fakeAlertasRepo({
      findById: async () =>
        makeAlerta({ tipo: 'stock_bajo', estado: 'activa' }),
    });
    const uow = fakeUow(alertas);

    await expect(
      resolver(uow, { id: 'alerta-1', actorId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_MANUALLY_RESOLVABLE' });
  });

  it('resolves an activa sugerencia_reposicion and audits the resolution (design.md D2)', async () => {
    const recordAudit = vi.fn(async () => {});
    const alertas = fakeAlertasRepo({
      findById: async () =>
        makeAlerta({ tipo: 'sugerencia_reposicion', estado: 'activa' }),
      manualResolve: async (id, resueltaPor) =>
        makeAlerta({
          id,
          tipo: 'sugerencia_reposicion',
          estado: 'resuelta',
          resueltaPor,
        }),
    });
    const uow = fakeUow(alertas, { record: recordAudit });

    const result = await resolver(uow, { id: 'alerta-1', actorId: 'user-1' });

    expect(result.estado).toBe('resuelta');
    expect(result.resueltaPor).toBe('user-1');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'alertas',
        accion: 'actualizar',
        usuarioId: 'user-1',
      }),
    );
  });

  it('throws ALERT_NOT_MANUALLY_RESOLVABLE for an activa quiebre alert', async () => {
    const alertas = fakeAlertasRepo({
      findById: async () => makeAlerta({ tipo: 'quiebre', estado: 'activa' }),
    });
    const uow = fakeUow(alertas);

    await expect(
      resolver(uow, { id: 'alerta-1', actorId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_MANUALLY_RESOLVABLE' });
  });

  it('throws ALERT_ALREADY_RESOLVED on the race where manualResolve returns undefined', async () => {
    const alertas = fakeAlertasRepo({
      findById: async () =>
        makeAlerta({ tipo: 'discrepancia', estado: 'vista' }),
      manualResolve: async () => undefined,
    });
    const uow = fakeUow(alertas);

    await expect(
      resolver(uow, { id: 'alerta-1', actorId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'ALERT_ALREADY_RESOLVED' });
  });
});
