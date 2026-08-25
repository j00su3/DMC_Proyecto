import { Pool } from 'pg';
import { type Db, createDb } from './client.js';

// Lazy singleton Pool + Db (D1). `plugins/db.ts` and `plugins/repos.ts` both
// consume this module so there is exactly one connection path to Postgres,
// keeping `DbLike { checkDb }` in `plugins/db.ts` unchanged.
let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) {
    db = createDb(getPool());
  }
  return db;
}
