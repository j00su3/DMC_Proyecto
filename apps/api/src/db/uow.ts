import type { Repos } from '../plugins/repos.js';
import { buildRepos } from '../plugins/repos.js';
import type { Db } from './client.js';

// The only thing a service is allowed to know about transactions. Note the
// shape: `work` receives repos, it never receives the raw executor. A
// service cannot obtain `tx`, so it cannot bypass the boundary (design.md
// D1) — inside `run`, the only repos in scope are the ones bound to `tx`.
export interface UnitOfWork {
  run<T>(work: (repos: Repos) => Promise<T>): Promise<T>;
}

// Wraps `db.transaction` so every repo the callback sees is bound to the
// same connection/transaction (design.md D1). `buildRepos(tx)` is the same
// factory `app.repos` uses for the pool-bound, non-transactional case.
export function createUnitOfWork(db: Db): UnitOfWork {
  return {
    run<T>(work: (repos: Repos) => Promise<T>): Promise<T> {
      return db.transaction((tx) => work(buildRepos(tx)));
    },
  };
}
