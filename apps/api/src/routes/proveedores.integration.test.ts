import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { proveedores, usuarios } from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

// The REAL app over real Postgres: real repos, real RBAC hook, real session
// cookie. `routes/proveedores.test.ts` proves the handlers against fakes;
// this proves the wiring the fakes stand in for — a genuine deposito
// session is genuinely refused, the audit row genuinely lands in the same
// transaction, and a forced audit failure genuinely rolls back the write.
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(
  rol: 'encargado' | 'deposito',
  nombre = 'Seed User',
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre,
      email: `proveedores-${randomUUID()}@example.com`,
      hashContrasena: await hashPassword(PASSWORD),
      rol,
    })
    .returning();
  if (!row) {
    throw new Error('seedUsuario: expected exactly one row back');
  }
  return row;
}

async function loginAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`loginAs: expected 200, got ${response.statusCode}`);
  }
  const raw = response.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw[0] : raw;
  const sid = /sid=([^;]+)/.exec(cookie ?? '')?.[1];
  if (!sid) {
    throw new Error('loginAs: no sid cookie in the login response');
  }
  return decodeURIComponent(sid);
}

async function auditRowsFor(entidadId: string) {
  const result = await db.execute(
    sql`select entidad, accion, usuario_id, datos_previos, datos_posteriores
          from auditoria where entidad_id = ${entidadId} order by creado_en`,
  );
  return (
    result as unknown as {
      rows: {
        entidad: string;
        accion: string;
        usuario_id: string;
        datos_previos: Record<string, unknown> | null;
        datos_posteriores: Record<string, unknown>;
      }[];
    }
  ).rows;
}

// File scope, NOT inside a describe: `afterAll` fires when its own block
// finishes, so closing the pool inside the first describe kills it for
// every later describe in this file (usuarios.integration.test.ts D-note).
afterAll(async () => {
  await getPool().end();
});

describe('proveedores role gate (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets a real deposito session read the list and a single supplier', async () => {
    const encargado = await seedUsuario('encargado');
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const actorSid = await loginAs(app, encargado.email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid: actorSid },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().proveedor.id;

    const sid = await loginAs(app, deposito.email);

    const list = await app.inject({
      method: 'GET',
      url: '/api/proveedores',
      cookies: { sid },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);

    const one = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${id}`,
      cookies: { sid },
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().proveedor.nombre).toBe('Distribuidora Norte');
  });

  it('refuses a real deposito session on every write route, genuinely — no row moves', async () => {
    const encargado = await seedUsuario('encargado');
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const actorSid = await loginAs(app, encargado.email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid: actorSid },
    });
    const id = created.json().proveedor.id;

    const sid = await loginAs(app, deposito.email);

    const create = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Otro Proveedor' },
      cookies: { sid },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe('FORBIDDEN');

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${id}`,
      payload: { nombre: 'Cambiado' },
      cookies: { sid },
    });
    expect(update.statusCode).toBe(403);
    expect(update.json().error.code).toBe('FORBIDDEN');

    const deactivate = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/deactivate`,
      cookies: { sid },
    });
    expect(deactivate.statusCode).toBe(403);
    expect(deactivate.json().error.code).toBe('FORBIDDEN');

    const reactivate = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/reactivate`,
      cookies: { sid },
    });
    expect(reactivate.statusCode).toBe(403);
    expect(reactivate.json().error.code).toBe('FORBIDDEN');

    // Nothing moved: the row still reads exactly as the encargado left it,
    // and only the encargado's own crear row exists in the trail.
    const [row] = await db
      .select()
      .from(proveedores)
      .where(eq(proveedores.id, id));
    expect(row?.nombre).toBe('Distribuidora Norte');
    expect(row?.activo).toBe(true);
    const rows = await auditRowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('crear');
  });
});

describe('proveedores uniqueness and lifecycle (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects a case-differing duplicate name over HTTP and keeps the original casing intact', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const first = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid },
    });
    expect(first.statusCode).toBe(201);
    const id = first.json().proveedor.id;

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'distribuidora norte' },
      cookies: { sid },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('SUPPLIER_NAME_IN_USE');

    const stored = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${id}`,
      cookies: { sid },
    });
    expect(stored.json().proveedor.nombre).toBe('Distribuidora Norte');

    // Only the first crear row exists — the failed duplicate wrote nothing.
    const rows = await auditRowsFor(id);
    expect(rows).toHaveLength(1);
  });

  it('refuses a PATCH that takes another supplier normalized name, changing no field', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Ferreteria Sur' },
      cookies: { sid },
    });
    const id = second.json().proveedor.id;

    const collision = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${id}`,
      payload: { nombre: 'distribuidora norte' },
      cookies: { sid },
    });

    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe('SUPPLIER_NAME_IN_USE');

    // The repository suite proves `repo.update()` maps 23505. This proves the
    // whole chain: `updateProveedor` runs a `changedFields` diff between the
    // request and the repository (service.ts), and a diff that folded case
    // would short-circuit before the index ever saw the collision — leaving a
    // silent 200 that every other test in this repo would still call green.
    const after = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${id}`,
      cookies: { sid },
    });
    expect(after.json().proveedor.nombre).toBe('Ferreteria Sur');
    // Only the original crear row — the refused PATCH filed no `actualizar`.
    const rows = await auditRowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('crear');
  });

  it('lets a deactivated supplier name keep blocking a duplicate create', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Norte' },
      cookies: { sid },
    });
    const id = created.json().proveedor.id;
    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/deactivate`,
      cookies: { sid },
    });
    expect(deactivated.json().proveedor.activo).toBe(false);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'DISTRIBUIDORA NORTE' },
      cookies: { sid },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('SUPPLIER_NAME_IN_USE');
    // The unique index carries no partial `WHERE activo` clause, so an
    // inactive row still owns its name. Pinning it here means adding such a
    // clause later fails loudly instead of silently allowing the duplicate.
    const count = await db.execute(
      sql`select count(*)::int as n from proveedores`,
    );
    expect((count as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
  });

  it('reports 404 SUPPLIER_NOT_FOUND for an id that matches no row', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/proveedores/00000000-0000-4000-8000-000000000000',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SUPPLIER_NOT_FOUND');
  });

  it('keeps a deactivated supplier readable by id with activo false, never gone', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Sur' },
      cookies: { sid },
    });
    const id = created.json().proveedor.id;

    const deactivated = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/deactivate`,
      cookies: { sid },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().proveedor.activo).toBe(false);

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/proveedores/${id}`,
      cookies: { sid },
    });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().proveedor.activo).toBe(false);
  });

  it('paginates the real envelope and reports the true total on an out-of-range page', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    for (const nombre of ['Uno', 'Dos', 'Tres']) {
      await app.inject({
        method: 'POST',
        url: '/api/proveedores',
        payload: { nombre },
        cookies: { sid },
      });
    }

    const outOfRange = await app.inject({
      method: 'GET',
      url: '/api/proveedores?page=5&pageSize=2',
      cookies: { sid },
    });
    expect(outOfRange.statusCode).toBe(200);
    expect(outOfRange.json().total).toBe(3);
    expect(outOfRange.json().data).toHaveLength(0);

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/proveedores?page=1&pageSize=2',
      cookies: { sid },
    });
    expect(page1.json().total).toBe(3);
    expect(page1.json().data).toHaveLength(2);
  });
});

describe('proveedores audit trail and atomic rollback (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table auditoria, sesiones, proveedores, usuarios cascade`,
    );
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('files exactly one crear row with the acting user as usuario_id', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Este' },
      cookies: { sid },
    });

    const rows = await auditRowsFor(created.json().proveedor.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('crear');
    expect(rows[0]?.usuario_id).toBe(encargado.id);
    expect(rows[0]?.datos_previos).toBeNull();
    // Read back from Postgres, not trusted from the service: `entidad` was
    // previously proven only against a fake `recordAudit`, so a wrong literal
    // would have survived every green test in this suite.
    expect(rows[0]?.entidad).toBe('proveedores');
  });

  it('files exactly one actualizar row with only the changed field, in both directions', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Nombre Viejo', contacto: 'viejo@example.com' },
      cookies: { sid },
    });
    const id = created.json().proveedor.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${id}`,
      payload: { nombre: 'Nombre Nuevo' },
      cookies: { sid },
    });
    expect(updated.statusCode).toBe(200);

    const rows = await auditRowsFor(id);
    // Two rows: the original crear (from this same supplier's creation) and
    // the actualizar the PATCH just filed. Only the second is under test.
    expect(rows).toHaveLength(2);
    expect(rows[1]?.accion).toBe('actualizar');
    expect(rows[1]?.usuario_id).toBe(encargado.id);
    expect(rows[1]?.datos_previos).toEqual({ nombre: 'Nombre Viejo' });
    expect(rows[1]?.datos_posteriores).toEqual({ nombre: 'Nombre Nuevo' });
  });

  it('files baja_logica on deactivate and reactivar on reactivate, one row each', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Oeste' },
      cookies: { sid },
    });
    const id = created.json().proveedor.id;

    await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/deactivate`,
      cookies: { sid },
    });
    let rows = await auditRowsFor(id);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.accion).toBe('baja_logica');
    expect(rows[1]?.usuario_id).toBe(encargado.id);

    await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/reactivate`,
      cookies: { sid },
    });
    rows = await auditRowsFor(id);
    expect(rows).toHaveLength(3);
    expect(rows[2]?.accion).toBe('reactivar');
    expect(rows[2]?.usuario_id).toBe(encargado.id);
    // Every verb across the whole lifecycle files under the same entidad.
    expect(rows.map((row) => row.entidad)).toEqual([
      'proveedores',
      'proveedores',
      'proveedores',
    ]);
  });

  it('rolls back the whole create when the paired audit write fails', async () => {
    const encargado = await seedUsuario('encargado');

    // A REAL transaction whose auditoria repo throws — mirrors
    // usuarios.integration.test.ts's failingUow technique exactly. The
    // proveedores INSERT is a genuine Postgres write; only recordAudit
    // fails, so this exercises the actual ROLLBACK, not a stubbed one.
    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos) =>
          work({
            ...repos,
            auditoria: {
              record: async () => {
                throw new Error('forced audit failure');
              },
            },
          }),
        ),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Nunca Existio' },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('AUDIT_WRITE_FAILED');

    const [row] = await db
      .select()
      .from(proveedores)
      .where(eq(proveedores.nombre, 'Nunca Existio'));
    expect(row).toBeUndefined();
    const result = await db.execute(
      sql`select count(*)::int as n from auditoria`,
    );
    expect((result as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0);
  });

  it('rolls back a deactivate when the paired audit write fails, leaving the row untouched', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      payload: { nombre: 'Distribuidora Rollback' },
      cookies: { sid },
    });
    const id = created.json().proveedor.id;
    await app.close();

    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos) =>
          work({
            ...repos,
            auditoria: {
              record: async () => {
                throw new Error('forced audit failure');
              },
            },
          }),
        ),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const failingSid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/proveedores/${id}/deactivate`,
      cookies: { sid: failingSid },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('AUDIT_WRITE_FAILED');

    const [row] = await db
      .select()
      .from(proveedores)
      .where(eq(proveedores.id, id));
    expect(row?.activo).toBe(true);
    // Only the original crear row survives — the failed deactivate wrote
    // nothing to auditoria either.
    const rows = await auditRowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('crear');
  });
});
