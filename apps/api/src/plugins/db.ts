import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getPool } from '../db/pool.js';

export interface DbLike {
  checkDb(): Promise<boolean>;
}

class PgDb implements DbLike {
  async checkDb(): Promise<boolean> {
    try {
      await getPool().query('select 1');
      return true;
    } catch {
      return false;
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DbLike;
  }
}

export interface DbPluginOptions {
  db?: DbLike;
}

export default fp<DbPluginOptions>(async function dbPlugin(
  app: FastifyInstance,
  opts: DbPluginOptions,
) {
  app.decorate('db', opts.db ?? new PgDb());
});
