import { describe, expect, it, vi } from 'vitest';
import {
  EvaluadorDeAlertas,
  type EvaluadorRepos,
  evaluar,
} from './evaluador.js';
import type { Alerta, TipoAlertaEvaluada } from './repository.js';

const ACTOR_ID = '00000000-0000-4000-8000-0000000000e1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const MOVIMIENTO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function alerta(over: Partial<Alerta> = {}): Alerta {
  return {
    id: 'alerta-1',
    productoId: PRODUCT_ID,
    tipo: 'stock_bajo',
    estado: 'activa',
    movimientoId: MOVIMIENTO_ID,
    creadaEn: new Date('2026-01-01T00:00:00.000Z'),
    resueltaEn: null,
    resueltaPor: null,
    ...over,
  };
}

interface Harness {
  repos: EvaluadorRepos;
  create: ReturnType<typeof vi.fn>;
  autoResolve: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    createResult?: Alerta | undefined;
    autoResolveResult?: Alerta | undefined;
  } = {},
): Harness {
  const createResult =
    'createResult' in options ? options.createResult : alerta();
  const autoResolveResult =
    'autoResolveResult' in options
      ? options.autoResolveResult
      : alerta({ estado: 'resuelta' });
  const create = vi.fn(async () => createResult);
  const autoResolve = vi.fn(async () => autoResolveResult);
  const record = vi.fn(async () => {});
  const repos = {
    alertas: { create, autoResolve },
    auditoria: { record },
  } as unknown as EvaluadorRepos;
  return { repos, create, autoResolve, record };
}

function movimiento(over: {
  cantidad: number;
  stockResultante: number;
  esDiscrepancia?: boolean;
}) {
  return {
    id: MOVIMIENTO_ID,
    productoId: PRODUCT_ID,
    cantidad: over.cantidad,
    stockResultante: over.stockResultante,
    esDiscrepancia: over.esDiscrepancia ?? false,
  };
}

describe('evaluar — threshold-crossing creation (stock_bajo)', () => {
  it('creates stock_bajo on a downward crossing below stockMinimo', async () => {
    const h = harness();

    // stockPrevio = 12 - (-4) = ... wait cantidad is the signed delta:
    // stockResultante - cantidad = stockPrevio. cantidad=-4, resultante=8 -> previo=12.
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -4, stockResultante: 8 }),
      stockMinimo: 10,
      actorId: ACTOR_ID,
    });

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        productoId: PRODUCT_ID,
        tipo: 'stock_bajo',
        movimientoId: MOVIMIENTO_ID,
      }),
    );
  });

  it('does not create stock_bajo when the crossing stays above stockMinimo', async () => {
    const h = harness();

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -1, stockResultante: 15 }),
      stockMinimo: 10,
      actorId: ACTOR_ID,
    });

    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('evaluar — quiebre (crossing to zero)', () => {
  it('creates quiebre when stock crosses from positive to zero or below', async () => {
    const h = harness();

    // previo = 0 - (-5) = 5, resultante = 0
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -5, stockResultante: 0 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'quiebre' }),
    );
  });

  it('stockMinimo=0: quiebre alone fires, stock_bajo is suppressed (quiebreCruzo guard)', async () => {
    const h = harness();

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -3, stockResultante: 0 }),
      stockMinimo: 0,
      actorId: ACTOR_ID,
    });

    const tiposCreados = h.create.mock.calls.map(
      (call) => (call[0] as { tipo: TipoAlertaEvaluada }).tipo,
    );
    expect(tiposCreados).toEqual(['quiebre']);
  });
});

describe('evaluar — auto-resolution on stock recovery', () => {
  it('auto-resolves quiebre when stock crosses from <=0 back above 0', async () => {
    const h = harness();

    // previo = 5 - 5 = 0, resultante = 5
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: 5, stockResultante: 5 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.autoResolve).toHaveBeenCalledWith(PRODUCT_ID, 'quiebre');
  });

  it('auto-resolves stock_bajo when stock crosses back above stockMinimo', async () => {
    const h = harness();

    // previo = 8 - 5 = 3 <= stockMinimo(10)? no wait need previo<=min and resultante>min
    // previo = 12 -> resultante 12+? use cantidad=5, resultante=15, previo=10
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: 5, stockResultante: 15 }),
      stockMinimo: 10,
      actorId: ACTOR_ID,
    });

    expect(h.autoResolve).toHaveBeenCalledWith(PRODUCT_ID, 'stock_bajo');
  });
});

describe('evaluar — discrepancia', () => {
  it('creates discrepancia when esDiscrepancia=true, regardless of stock math', async () => {
    const h = harness();

    await evaluar(h.repos, {
      movimiento: movimiento({
        cantidad: 0,
        stockResultante: 50,
        esDiscrepancia: true,
      }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'discrepancia' }),
    );
  });

  it('an ajuste without the flag creates no discrepancia', async () => {
    const h = harness();

    await evaluar(h.repos, {
      movimiento: movimiento({
        cantidad: 0,
        stockResultante: 50,
        esDiscrepancia: false,
      }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'discrepancia' }),
    );
  });
});

describe('evaluar — stockMinimo null and exact-equality boundaries', () => {
  it('stockMinimo=null never fires stock_bajo even on a large downward move', async () => {
    const h = harness();

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -100, stockResultante: 5 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.create).not.toHaveBeenCalled();
  });

  it('exact equality stockResultante === stockMinimo triggers stock_bajo', async () => {
    const h = harness();

    // previo = 15, resultante = 10 === stockMinimo
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -5, stockResultante: 10 }),
      stockMinimo: 10,
      actorId: ACTOR_ID,
    });

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'stock_bajo' }),
    );
  });

  it('exact equality stockResultante === 0 triggers quiebre, not a redundant stock_bajo', async () => {
    const h = harness();

    // previo = 5, resultante = 0
    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -5, stockResultante: 0 }),
      stockMinimo: 5,
      actorId: ACTOR_ID,
    });

    const tiposCreados = h.create.mock.calls.map(
      (call) => (call[0] as { tipo: TipoAlertaEvaluada }).tipo,
    );
    expect(tiposCreados).toEqual(['quiebre']);
  });
});

describe('evaluar — de-duplication (D4): a create() returning undefined files no audit', () => {
  it('does not call recordAudit when alertas.create signals an existing open alert (undefined)', async () => {
    const h = harness({ createResult: undefined });

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -5, stockResultante: 0 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.create).toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe('evaluar — audit wiring (D2): create/autoResolve success records an audit row', () => {
  it('records a crear audit row after a successful create', async () => {
    const h = harness({ createResult: alerta({ id: 'alerta-created' }) });

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: -5, stockResultante: 0 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'alertas',
        entidadId: 'alerta-created',
        accion: 'crear',
        usuarioId: ACTOR_ID,
        datosPrevios: null,
      }),
    );
  });

  it('records an actualizar audit row after a successful auto-resolve', async () => {
    const h = harness({
      autoResolveResult: alerta({ id: 'alerta-resolved', estado: 'resuelta' }),
    });

    await evaluar(h.repos, {
      movimiento: movimiento({ cantidad: 5, stockResultante: 5 }),
      stockMinimo: null,
      actorId: ACTOR_ID,
    });

    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'alertas',
        entidadId: 'alerta-resolved',
        accion: 'actualizar',
        usuarioId: ACTOR_ID,
      }),
    );
  });
});

describe('EvaluadorDeAlertas.evaluar — same function, exported as the design-named object', () => {
  it('is the same evaluar function', () => {
    expect(EvaluadorDeAlertas.evaluar).toBe(evaluar);
  });
});
