import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema.js';

/**
 * Builds a Drizzle client over an existing `pg` Pool. Callers are expected
 * to supply the same Pool used elsewhere (see `plugins/db.ts`) rather than
 * opening a second connection path to Postgres.
 */
export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

// Anything that can run a query: either the pool-bound `Db` itself, or the
// transaction handle Drizzle passes into a `db.transaction(tx => …)`
// callback. Derived from `Db['transaction']` itself so a Drizzle upgrade
// cannot desynchronise the two arms (design.md D2).
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
