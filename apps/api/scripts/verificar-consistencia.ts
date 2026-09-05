import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getDb } from '../src/db/pool.js';
import { DrizzleMovimientosRepo } from '../src/movimientos/repository.js';
import type { MovimientosRepo } from '../src/movimientos/repository.js';

// Periodic stock consistency check (design.md D2, backlog #14,
// consistency-check half). Human/schedule-invoked, never part of the API —
// read-only against `verificarConsistenciaStock()`, no write path exists in
// this script by construction.

// The whole point of exporting this (rather than only a bare `main()`, D2/D5)
// is that the exit-code branch — including the "repo call throws" branch —
// stays directly testable with an injected fake repo, no subprocess spawn.
export async function verificarConsistencia(
  repo: MovimientosRepo,
): Promise<0 | 1> {
  try {
    const inconsistencias = await repo.verificarConsistenciaStock();

    if (inconsistencias.length === 0) {
      // The query only ever returns mismatching rows (design.md D1's HAVING
      // clause filters server-side), so there is no real "N productos
      // checked" count available here -- stating one would be fabricated.
      console.log('No mismatches found.');
      return 0;
    }

    console.log(`${inconsistencias.length} mismatch(es) found:`);
    for (const inconsistencia of inconsistencias) {
      console.log(
        `  producto ${inconsistencia.productoId} (sku=${inconsistencia.sku}): stockActual=${inconsistencia.stockActual}, sumaMovimientos=${inconsistencia.sumaMovimientos}, delta=${inconsistencia.delta}`,
      );
    }
    return 1;
  } catch (err) {
    // Never swallowed (design.md Threat Matrix "Neon connection failure").
    // Drizzle's query-error message is often just "Failed query: ...\nparams:
    // ..." with the actual driver/Postgres reason chained as `.cause` — print
    // both, or a CI failure is undiagnosable from the log alone.
    logError(err);
    return 1;
  }
}

function logError(err: unknown): void {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) {
    console.error(
      'Caused by:',
      err.cause instanceof Error ? err.cause.message : err.cause,
    );
  }
}

async function main() {
  const db = getDb();
  const repo = new DrizzleMovimientosRepo(db);
  process.exitCode = await verificarConsistencia(repo);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    logError(err);
    process.exitCode = 1;
  });
}
