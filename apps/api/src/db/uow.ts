import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Repos } from '../plugins/repos.js';
import { buildRepos } from '../plugins/repos.js';
import type { Db, DbExecutor } from './client.js';

// The narrowest logger shape createTxControl needs. `FastifyBaseLogger` is
// structurally compatible (app.log is passed in production, design.md D1);
// a no-op default keeps every existing createUnitOfWork(db) call site
// (integration tests, fakes) source-compatible without wiring a logger.
export type Logger = Pick<FastifyBaseLogger, 'error'>;

const silentLogger: Logger = {
  error() {
    // Intentionally silent — the default logger for callers that never
    // pass one (e.g. tests constructing createUnitOfWork(db) directly).
  },
};

// design.md D1/D2: the only capability a service can obtain to run SQL
// outside the repos it already has — one narrow method, not the raw
// executor. Handed to `work` as `uow.run`'s SECOND argument, never on
// `Repos`, so it is structurally impossible to reach outside a transaction
// (see this file's UnitOfWork.run doc comment).
export interface TxControl {
  /** Runs `work` inside `SAVEPOINT <name>`. On ANY failure: ROLLBACK TO,
   *  log, return `undefined` — the outer transaction stays committable
   *  (C1, ADR-0008). */
  savepoint<T>(name: string, work: () => Promise<T>): Promise<T | undefined>;
}

// `sp` is built once via `sql.identifier`, never string-interpolated, so
// the savepoint name can never carry attacker- or caller-controlled SQL —
// design.md's Threat Matrix names this as the one raw-SQL surface in the
// whole change and rules it out on exactly this basis.
function createTxControl(tx: DbExecutor, log: Logger): TxControl {
  return {
    async savepoint<T>(
      name: string,
      work: () => Promise<T>,
    ): Promise<T | undefined> {
      const sp = sql.identifier(name);
      await tx.execute(sql`SAVEPOINT ${sp}`); // control-statement failures
      try {
        // propagate: the tx itself is dead if this throws.
        const result = await work();
        await tx.execute(sql`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sp}`);
        // RELEASE after ROLLBACK TO is required: ROLLBACK TO leaves the
        // savepoint defined, and a caller (e.g. confirmarVenta's per-item
        // loop) may re-enter the same name — this bounds the stack.
        await tx.execute(sql`RELEASE SAVEPOINT ${sp}`);
        log.error({ err: error, savepoint: name }, 'savepoint rolled back');
        return undefined;
      }
    },
  };
}

// The only thing a service is allowed to know about transactions. Note the
// shape: `work` receives repos and (design.md D2) a narrow `TxControl` as a
// SECOND argument, never the raw executor. A service cannot obtain `tx`
// directly, so it cannot bypass the boundary — inside `run`, the only repos
// in scope are the ones bound to `tx`, and the only SQL capability in scope
// is `TxControl.savepoint`.
export interface UnitOfWork {
  run<T>(work: (repos: Repos, tx: TxControl) => Promise<T>): Promise<T>;
}

// Wraps `db.transaction` so every repo the callback sees is bound to the
// same connection/transaction (design.md D1), and hands it a `TxControl`
// bound to that same connection. `buildRepos(tx)` is the same factory
// `app.repos` uses for the pool-bound, non-transactional case.
export function createUnitOfWork(
  db: Db,
  log: Logger = silentLogger,
): UnitOfWork {
  return {
    run<T>(work: (repos: Repos, tx: TxControl) => Promise<T>): Promise<T> {
      return db.transaction((tx) =>
        work(buildRepos(tx), createTxControl(tx, log)),
      );
    },
  };
}
