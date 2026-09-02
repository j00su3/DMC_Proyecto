import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
import type { AuditoriaRepo } from '../auditoria/repository.js';
import type { SesionesRepo } from '../auth/repository.js';
import type { DbExecutor } from '../db/client.js';
import type { TxControl } from '../db/uow.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { UsuariosRepo } from '../usuarios/repository.js';
import type { VentasRepo } from '../ventas/repository.js';
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
    const fakeProveedores = {} as ProveedoresRepo;
    const fakeProductos = {} as ProductosRepo;
    const fakeMovimientos = {} as MovimientosRepo;
    const fakeVentas = {} as VentasRepo;
    const fakeAlertas = {} as AlertasRepo;

    await app.register(reposPlugin, {
      repos: {
        usuarios: fakeUsuarios,
        sesiones: fakeSesiones,
        auditoria: fakeAuditoria,
        proveedores: fakeProveedores,
        productos: fakeProductos,
        movimientos: fakeMovimientos,
        ventas: fakeVentas,
        alertas: fakeAlertas,
      },
    });
    await app.ready();

    expect(app.repos.usuarios).toBe(fakeUsuarios);
    expect(app.repos.sesiones).toBe(fakeSesiones);
    expect(app.repos.auditoria).toBe(fakeAuditoria);
    expect(app.repos.proveedores).toBe(fakeProveedores);
    expect(app.repos.productos).toBe(fakeProductos);
    expect(app.repos.movimientos).toBe(fakeMovimientos);
    expect(app.repos.ventas).toBe(fakeVentas);
    expect(app.repos.alertas).toBe(fakeAlertas);

    await app.close();
  });

  it('decorates app.repos with real Drizzle-backed repos when none are injected', async () => {
    const app = Fastify();

    await app.register(reposPlugin);
    await app.ready();

    expect(app.repos.usuarios).toBeDefined();
    expect(app.repos.sesiones).toBeDefined();
    expect(app.repos.auditoria).toBeDefined();
    expect(app.repos.proveedores).toBeDefined();
    expect(app.repos.productos).toBeDefined();
    expect(app.repos.movimientos).toBeDefined();
    expect(app.repos.ventas).toBeDefined();
    expect(app.repos.alertas).toBeDefined();

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
    const fakeRun = async <T>(
      work: (repos: Repos, tx: TxControl) => Promise<T>,
    ) =>
      work(
        {
          usuarios: {} as UsuariosRepo,
          sesiones: {} as SesionesRepo,
          auditoria: {} as AuditoriaRepo,
          proveedores: {} as ProveedoresRepo,
          productos: {} as ProductosRepo,
          movimientos: {} as MovimientosRepo,
          ventas: {} as VentasRepo,
          alertas: {} as AlertasRepo,
        },
        { savepoint: async (_name, fn) => fn() },
      );

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
    expect(repos.proveedores).toBeDefined();
    expect(repos.productos).toBeDefined();
    expect(repos.movimientos).toBeDefined();
    expect(repos.ventas).toBeDefined();
    expect(repos.alertas).toBeDefined();
  });
});
