import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { DbExecutor } from '../db/client.js';
import type { UsuariosRepo } from '../usuarios/repository.js';
import { type Repos, buildRepos } from './repos.js';
import reposPlugin from './repos.js';

// Fake executor: buildRepos() never calls methods on it directly (the repo
// classes hold the reference, they don't invoke it at construction time), so
// an empty object cast is enough to prove the factory wires it through.
const fakeExecutor = {} as DbExecutor;

describe('repos plugin', () => {
  it('decorates app.repos with injected fakes', async () => {
    const app = Fastify();
    const fakeUsuarios = {} as UsuariosRepo;
    const fakeSesiones = {} as SesionesRepo;
    const fakeAuditoria = {} as AuditoriaRepo;

    await app.register(reposPlugin, {
      repos: {
        usuarios: fakeUsuarios,
        sesiones: fakeSesiones,
        auditoria: fakeAuditoria,
      },
    });
    await app.ready();

    expect(app.repos.usuarios).toBe(fakeUsuarios);
    expect(app.repos.sesiones).toBe(fakeSesiones);
    expect(app.repos.auditoria).toBe(fakeAuditoria);

    await app.close();
  });

  it('decorates app.repos with real Drizzle-backed repos when none are injected', async () => {
    const app = Fastify();

    await app.register(reposPlugin);
    await app.ready();

    expect(app.repos.usuarios).toBeDefined();
    expect(app.repos.sesiones).toBeDefined();
    expect(app.repos.auditoria).toBeDefined();

    await app.close();
  });

  it('decorates app.uow with a real UnitOfWork when none is injected', async () => {
    const app = Fastify();

    await app.register(reposPlugin);
    await app.ready();

    expect(app.uow).toBeDefined();
    expect(typeof app.uow.run).toBe('function');

    await app.close();
  });

  it('decorates app.uow with an injected fake, overriding the real one', async () => {
    const app = Fastify();
    const fakeRun = async <T>(work: (repos: Repos) => Promise<T>) =>
      work({
        usuarios: {} as UsuariosRepo,
        sesiones: {} as SesionesRepo,
        auditoria: {} as AuditoriaRepo,
      });

    await app.register(reposPlugin, { uow: { run: fakeRun } });
    await app.ready();

    expect(app.uow.run).toBe(fakeRun);

    await app.close();
  });
});

describe('buildRepos', () => {
  it('returns every member of Repos bound to the given executor', () => {
    const repos = buildRepos(fakeExecutor);

    expect(repos.usuarios).toBeDefined();
    expect(repos.sesiones).toBeDefined();
    expect(repos.auditoria).toBeDefined();
  });
});
