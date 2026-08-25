import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Pool } from 'pg';

export interface DbLike {
  checkDb(): Promise<boolean>;
}

class PgDb implements DbLike {
  private pool: Pool | undefined;

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    return this.pool;
  }

  async checkDb(): Promise<boolean> {
    try {
      await this.getPool().query('select 1');
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
