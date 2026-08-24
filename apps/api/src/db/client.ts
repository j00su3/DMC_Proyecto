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
