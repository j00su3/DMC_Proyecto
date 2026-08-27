import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  type AuditoriaRepo,
  DrizzleAuditoriaRepo,
} from '../auditoria/repository.js';
import {
  DrizzleSesionesRepo,
  DrizzleUsuariosRepo,
  type SesionesRepo,
  type UsuariosRepo,
} from '../auth/repository.js';
import type { DbExecutor } from '../db/client.js';
import { getDb } from '../db/pool.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

export interface Repos {
  usuarios: UsuariosRepo;
  sesiones: SesionesRepo;
  auditoria: AuditoriaRepo;
}

// Binds every repo to the same executor (design.md D1/D2). Called with the
// pool-bound `Db` for `app.repos`, and with a transaction handle inside
// `uow.run` — the only repos ever in scope inside a transaction are the ones
// this factory just built from `tx`, so there is no un-bound repo to reach
// for by accident.
export function buildRepos(executor: DbExecutor): Repos {
  return {
    usuarios: new DrizzleUsuariosRepo(executor),
    sesiones: new DrizzleSesionesRepo(executor),
    auditoria: new DrizzleAuditoriaRepo(executor),
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    repos: Repos;
    uow: UnitOfWork;
  }
}

export interface ReposPluginOptions {
  repos?: Repos;
  uow?: UnitOfWork;
}

export default fp<ReposPluginOptions>(async function reposPlugin(
  app: FastifyInstance,
  opts: ReposPluginOptions,
) {
  app.decorate('repos', opts.repos ?? buildRepos(getDb()));
  app.decorate('uow', opts.uow ?? createUnitOfWork(getDb()));
});
