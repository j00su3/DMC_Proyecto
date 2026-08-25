import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  DrizzleSesionesRepo,
  DrizzleUsuariosRepo,
  type SesionesRepo,
  type UsuariosRepo,
} from '../auth/repository.js';
import { getDb } from '../db/pool.js';

export interface Repos {
  usuarios: UsuariosRepo;
  sesiones: SesionesRepo;
}

declare module 'fastify' {
  interface FastifyInstance {
    repos: Repos;
  }
}

export interface ReposPluginOptions {
  repos?: Repos;
}

export default fp<ReposPluginOptions>(async function reposPlugin(
  app: FastifyInstance,
  opts: ReposPluginOptions,
) {
  app.decorate(
    'repos',
    opts.repos ?? {
      usuarios: new DrizzleUsuariosRepo(getDb()),
      sesiones: new DrizzleSesionesRepo(getDb()),
    },
  );
});
