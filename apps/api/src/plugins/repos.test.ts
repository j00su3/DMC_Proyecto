import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { SesionesRepo, UsuariosRepo } from '../auth/repository.js';
import reposPlugin from './repos.js';

describe('repos plugin', () => {
  it('decorates app.repos with injected fakes', async () => {
    const app = Fastify();
    const fakeUsuarios = {} as UsuariosRepo;
    const fakeSesiones = {} as SesionesRepo;

    await app.register(reposPlugin, {
      repos: { usuarios: fakeUsuarios, sesiones: fakeSesiones },
    });
    await app.ready();

    expect(app.repos.usuarios).toBe(fakeUsuarios);
    expect(app.repos.sesiones).toBe(fakeSesiones);

    await app.close();
  });

  it('decorates app.repos with real Drizzle-backed repos when none are injected', async () => {
    const app = Fastify();

    await app.register(reposPlugin);
    await app.ready();

    expect(app.repos.usuarios).toBeDefined();
    expect(app.repos.sesiones).toBeDefined();

    await app.close();
  });
});
