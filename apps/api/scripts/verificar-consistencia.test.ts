import { describe, expect, it, vi } from 'vitest';
import type {
  InconsistenciaStock,
  MovimientosRepo,
} from '../src/movimientos/repository.js';
import { verificarConsistencia } from './verificar-consistencia.js';

// Direct-invocation unit tests over an injected fake repo, mirroring
// `seed-encargado.test.ts`'s exact pattern (design.md D5): no subprocess
// spawn. `verificarConsistenciaStock()` is the only method exercised — the
// other `MovimientosRepo` methods are never called by this script.
function createFakeRepo(
  verificarConsistenciaStock: MovimientosRepo['verificarConsistenciaStock'],
): MovimientosRepo {
  return {
    create: vi.fn(),
    listByProducto: vi.fn(),
    resumenRotacion: vi.fn(),
    listByPeriodo: vi.fn(),
    listRecientes: vi.fn(),
    verificarConsistenciaStock,
  } as unknown as MovimientosRepo;
}

const mismatch: InconsistenciaStock = {
  productoId: 'producto-1',
  sku: 'SKU-1',
  stockActual: 10,
  sumaMovimientos: 4,
  delta: 6,
};

describe('verificarConsistencia', () => {
  it('exits 0 and reports zero mismatches when the repo returns an empty result', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const repo = createFakeRepo(vi.fn(async () => []));

    const exitCode = await verificarConsistencia(repo);

    expect(exitCode).toBe(0);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'No mismatches found. 0 productos checked.',
    );
    consoleLogSpy.mockRestore();
  });

  it('exits 1 and names each mismatching producto when the repo returns at least one', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const repo = createFakeRepo(vi.fn(async () => [mismatch]));

    const exitCode = await verificarConsistencia(repo);

    expect(exitCode).toBe(1);
    const loggedOutput = consoleLogSpy.mock.calls
      .map((call) => call.join(' '))
      .join('\n');
    expect(loggedOutput).toContain(mismatch.productoId);
    expect(loggedOutput).toContain(mismatch.sku);
    consoleLogSpy.mockRestore();
  });

  it('exits 1 and logs the error, never swallowed, when the repo call throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const repo = createFakeRepo(
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    const exitCode = await verificarConsistencia(repo);

    expect(exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('connection refused');
    consoleErrorSpy.mockRestore();
  });
});
