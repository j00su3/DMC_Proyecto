import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../app.js';
import { pseudonymizeFields } from '../auditoria/service.js';
import { hashPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { usuarios } from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';

// The REAL app over real Postgres: real repos, real RBAC hook, real session
// cookie. The unit suite proves the handlers against fakes; this proves the
// wiring the fakes stand in for — that the routes are registered after
// authPlugin, that a real login produces a cookie these routes accept, and
// that a row read out of Postgres serialises without its hash.
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
      email: `routes-${randomUUID()}@example.com`,
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

// File scope, NOT inside a describe: `afterAll` fires when its own block
// finishes, so closing the pool inside the first describe kills it for every
// later one in the same file.
afterAll(async () => {
  await getPool().end();
});

describe('usuarios read routes (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lists real rows for an encargado and never serialises the hash', async () => {
    const encargado = await seedUsuario('encargado', 'Ana Encargada');
    await seedUsuario('deposito', 'Beto Deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    // Asserted on the raw body, not on parsed keys: the hash must not appear
    // anywhere in the bytes that leave the process.
    expect(response.body).not.toContain('hashContrasena');
    expect(response.body).not.toContain('hash_contrasena');
    expect(response.body).not.toContain(encargado.hashContrasena);
  });

  it('returns 403 for a real deposito session', async () => {
    const deposito = await seedUsuario('deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('gets one real row by id and never serialises the hash', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Beto Deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: `/api/usuarios/${objetivo.id}`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario).toMatchObject({
      id: objetivo.id,
      nombre: 'Beto Deposito',
      rol: 'deposito',
      activo: true,
    });
    expect(response.body).not.toContain('hashContrasena');
    expect(response.body).not.toContain(objetivo.hashContrasena);
  });

  it('returns 404 USER_NOT_FOUND for a well-formed id that matches no row', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'GET',
      url: '/api/usuarios/00000000-0000-4000-8000-000000000000',
      cookies: { sid },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('paginates real rows without overlap across pages', async () => {
    const encargado = await seedUsuario('encargado');
    await seedUsuario('deposito', 'Uno');
    await seedUsuario('deposito', 'Dos');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const page1 = await app.inject({
      method: 'GET',
      url: '/api/usuarios?page=1&pageSize=2',
      cookies: { sid },
    });
    const page2 = await app.inject({
      method: 'GET',
      url: '/api/usuarios?page=2&pageSize=2',
      cookies: { sid },
    });

    expect(page1.json().total).toBe(3);
    expect(page2.json().total).toBe(3);
    const ids = [
      ...page1.json().data.map((r: { id: string }) => r.id),
      ...page2.json().data.map((r: { id: string }) => r.id),
    ];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('usuarios write routes (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function auditRows(entidadId: string) {
    const result = await db.execute(
      sql`select accion, usuario_id, datos_previos, datos_posteriores
            from auditoria where entidad_id = ${entidadId} order by creado_en`,
    );
    return (
      result as unknown as {
        rows: {
          accion: string;
          usuario_id: string;
          datos_previos: unknown;
          datos_posteriores: unknown;
        }[];
      }
    ).rows;
  }

  it('creates a user whose temporary password works and forces a change on first use', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: {
        nombre: 'Beto Deposito',
        email: 'beto@example.com',
        rol: 'deposito',
      },
      cookies: { sid },
    });
    expect(created.statusCode).toBe(201);
    const temporal = created.json().passwordTemporal;

    // The whole point of the temporary-password flow: the credential the
    // encargado reads out loud actually logs in.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'beto@example.com', password: temporal },
    });
    expect(login.statusCode).toBe(200);
    const rawCookie = login.headers['set-cookie'];
    const betoSid = decodeURIComponent(
      /sid=([^;]+)/.exec(
        (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie) ?? '',
      )?.[1] ?? '',
    );

    // ...and then goes nowhere until the password is changed. Enforced
    // server-side, not by the SPA router (app-shell-login D3).
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/usuarios',
      cookies: { sid: betoSid },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: {
        currentPassword: temporal,
        newPassword: 'a-brand-new-password-1',
      },
      cookies: { sid: betoSid },
    });
    expect(changed.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: betoSid },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().usuario.debeCambiarPassword).toBe(false);
  });

  it('files exactly one crear audit row, with no hash in either snapshot', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: {
        nombre: 'Beto Deposito',
        email: 'beto@example.com',
        rol: 'deposito',
      },
      cookies: { sid },
    });

    const rows = await auditRows(created.json().usuario.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('crear');
    // Actor, not subject: an admin action is exactly the row where the two
    // differ (D12).
    expect(rows[0]?.usuario_id).toBe(encargado.id);
    expect(rows[0]?.datos_previos).toBeNull();
    expect(JSON.stringify(rows[0]?.datos_posteriores)).not.toContain(
      'hashContrasena',
    );
    // D-22: the created name is a pseudonym, never plaintext.
    expect(JSON.stringify(rows[0]?.datos_posteriores)).not.toContain(
      'Beto Deposito',
    );
  });

  it('rescues a locked account: the reset password logs in immediately', async () => {
    const encargado = await seedUsuario('encargado');
    const victima = await seedUsuario('deposito', 'Victima');
    // Locked out by brute force, with the window still open.
    await db
      .update(usuarios)
      .set({
        intentosFallidos: 5,
        bloqueadoHasta: new Date(Date.now() + 300_000),
      })
      .where(eq(usuarios.id, victima.id));
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${victima.id}/password-reset`,
      cookies: { sid },
    });
    expect(reset.statusCode).toBe(200);

    // D11 is a correctness requirement, not a nicety: auth/service.ts checks
    // the lockout BEFORE verifying the password, so without clearing it in
    // the same statement the victim could never spend the credential the
    // encargado just issued.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: victima.email,
        password: reset.json().passwordTemporal,
      },
    });
    expect(login.statusCode).toBe(200);
  });

  it('revokes every session of the target while the actor keeps its own', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const actorSid = await loginAs(app, encargado.email);
    const objetivoSid = await loginAs(app, objetivo.email);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/password-reset`,
      cookies: { sid: actorSid },
    });
    expect(reset.statusCode).toBe(200);

    // D10: every session of the target dies, including ones opened before
    // the reset — the trigger is normally a compromised credential.
    const objetivoMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: objetivoSid },
    });
    expect(objetivoMe.statusCode).toBe(401);

    // The actor is a different principal and keeps working.
    const actorMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: actorSid },
    });
    expect(actorMe.statusCode).toBe(200);
  });

  it('files cambiar_password with the prior lockout state', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    await db
      .update(usuarios)
      .set({ intentosFallidos: 4 })
      .where(eq(usuarios.id, objetivo.id));
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/password-reset`,
      cookies: { sid },
    });

    const rows = await auditRows(objetivo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('cambiar_password');
    // The non-repudiation property itself (D12): an admin reset is exactly
    // the row where the actor and the subject differ. File the target as the
    // actor and the trail says the user reset their own password — which is
    // the specific lie the whole auditoria table exists to prevent.
    expect(rows[0]?.usuario_id).toBe(encargado.id);
    expect(rows[0]?.usuario_id).not.toBe(objetivo.id);
    expect(rows[0]?.datos_previos).toMatchObject({ intentosFallidos: 4 });
    expect(rows[0]?.datos_posteriores).toMatchObject({
      debeCambiarPassword: true,
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    expect(JSON.stringify(rows[0])).not.toContain('hashContrasena');
  });

  // rescate-encargado D2: the origin marker belongs to the operator rescue
  // alone. Both in-app password paths must leave it out of either snapshot.
  it('files the in-app admin reset without an origen marker, actor distinct from subject', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/password-reset`,
      cookies: { sid },
    });
    expect(reset.statusCode).toBe(200);

    const rows = await auditRows(objetivo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usuario_id).not.toBe(objetivo.id);
    expect(rows[0]?.datos_previos).not.toHaveProperty('origen');
    expect(rows[0]?.datos_posteriores).not.toHaveProperty('origen');
  });

  it('files the self-service password change without an origen marker', async () => {
    const deposito = await seedUsuario('deposito', 'Self Service');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, deposito.email);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: {
        currentPassword: PASSWORD,
        newPassword: 'a-brand-new-password-1',
      },
      cookies: { sid },
    });
    expect(changed.statusCode).toBe(200);

    const rows = await auditRows(deposito.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.datos_previos).not.toHaveProperty('origen');
    expect(rows[0]?.datos_posteriores).not.toHaveProperty('origen');
  });

  it('rolls back the whole reset when the audit write fails', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    const hashAntes = objetivo.hashContrasena;

    // A REAL transaction whose audit repo throws. The usuarios UPDATE and
    // the session delete are genuine Postgres writes; only recordAudit
    // fails, so this exercises the actual ROLLBACK rather than a fake one.
    const realUow = createUnitOfWork(db);
    const failingUow: UnitOfWork = {
      run: (work) =>
        realUow.run((repos, tx) =>
          work(
            {
              ...repos,
              auditoria: {
                record: async () => {
                  throw new Error('forced audit failure');
                },
                list: async () => ({ rows: [], total: 0 }),
              },
            },
            tx,
          ),
        ),
    };
    app = await buildApp({ cookieSecret: COOKIE_SECRET, uow: failingUow });
    await app.ready();
    const sid = await loginAs(app, encargado.email);
    const objetivoSid = await loginAs(app, objetivo.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/password-reset`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('AUDIT_WRITE_FAILED');

    // Nothing moved: not the hash, not the flag, not the counters.
    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, objetivo.id));
    expect(row?.hashContrasena).toBe(hashAntes);
    expect(row?.debeCambiarPassword).toBe(false);
    // And the session revocation rolled back with it — the target can still
    // use the session it had, because the reset never happened.
    const objetivoMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: objetivoSid },
    });
    expect(objetivoMe.statusCode).toBe(200);
    expect(await auditRows(objetivo.id)).toHaveLength(0);
  });

  it('rejects a duplicate email with 409 and writes nothing', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: {
        nombre: 'Clon',
        email: encargado.email,
        rol: 'deposito',
      },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_ALREADY_IN_USE');
    // The 23505 is raised inside uow.run, so the transaction rolls back and
    // no audit row survives (D9).
    const result = await db.execute(
      sql`select count(*)::int as n from auditoria`,
    );
    expect((result as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0);
  });
});

describe('usuarios activo and update routes (integration, real app + real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app?.close();
    app = undefined;
  });

  async function auditRowsFor(entidadId: string) {
    const result = await db.execute(
      sql`select accion, usuario_id, datos_previos, datos_posteriores
            from auditoria where entidad_id = ${entidadId} order by creado_en`,
    );
    return (
      result as unknown as {
        rows: {
          accion: string;
          usuario_id: string;
          datos_previos: Record<string, unknown> | null;
          datos_posteriores: Record<string, unknown>;
        }[];
      }
    ).rows;
  }

  it('updates a profile and files exactly one actualizar row with only the changed field', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Nombre Viejo');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${objetivo.id}`,
      payload: { nombre: 'Nombre Nuevo' },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.nombre).toBe('Nombre Nuevo');

    const rows = await auditRowsFor(objetivo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('actualizar');
    expect(rows[0]?.usuario_id).toBe(encargado.id);
    // Changed fields only: email and rol did not move, so they are in
    // neither snapshot. `nombre` is stored as its keyed pseudonym (D-22),
    // derived here from the same COOKIE_SECRET the HMAC reads, which is the
    // process env, not the `cookieSecret` option given to `buildApp`.
    const key = process.env.COOKIE_SECRET as string;
    expect(rows[0]?.datos_previos).toEqual(
      pseudonymizeFields({ nombre: 'Nombre Viejo' }, ['nombre'], key),
    );
    expect(rows[0]?.datos_posteriores).toEqual(
      pseudonymizeFields({ nombre: 'Nombre Nuevo' }, ['nombre'], key),
    );
  });

  // D-22's own test: no name, old or new, appears anywhere in the stored
  // rows after a real create followed by a real rename.
  it('stores no plaintext name in the audit rows after a create then a rename', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      payload: {
        nombre: 'Primer Nombre',
        email: 'primer@example.com',
        rol: 'deposito',
      },
      cookies: { sid },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().usuario.id as string;

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${id}`,
      payload: { nombre: 'Segundo Nombre' },
      cookies: { sid },
    });
    expect(renamed.statusCode).toBe(200);

    const result = await db.execute(
      sql`select datos_previos::text as previos, datos_posteriores::text as posteriores
            from auditoria where entidad_id = ${id}`,
    );
    const rows = (
      result as unknown as {
        rows: { previos: string | null; posteriores: string }[];
      }
    ).rows;
    expect(rows).toHaveLength(2);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('Primer Nombre');
    expect(stored).not.toContain('Segundo Nombre');
  });

  it('refuses a name-only PATCH when COOKIE_SECRET is missing: the name is unchanged and no audit row exists', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Nombre Intacto');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    // Log in first: the session cookie is signed with the `cookieSecret`
    // option, while the audit HMAC reads `process.env.COOKIE_SECRET`.
    const sid = await loginAs(app, encargado.email);
    vi.stubEnv('COOKIE_SECRET', undefined);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${objetivo.id}`,
      payload: { nombre: 'Nombre Que No Debe Quedar' },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(500);
    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, objetivo.id));
    expect(row?.nombre).toBe('Nombre Intacto');
    expect(await auditRowsFor(objetivo.id)).toHaveLength(0);
  });

  // Spec "No update path to existing rows": a row written before the change
  // keeps its plaintext name, and the read path returns it as stored.
  it('returns a pre-change audit row with a plaintext nombre unchanged', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Nombre Actual');
    await db.execute(
      sql`insert into auditoria (entidad, entidad_id, accion, usuario_id, datos_previos, datos_posteriores)
            values ('usuarios', ${objetivo.id}, 'actualizar', ${encargado.id},
                    '{"nombre": "Nombre Historico"}'::jsonb,
                    '{"nombre": "Nombre Anterior"}'::jsonb)`,
    );
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const audit = await app.inject({
      method: 'GET',
      url: `/api/auditoria?entidad=usuarios&entidadId=${objetivo.id}`,
      cookies: { sid },
    });

    expect(audit.statusCode).toBe(200);
    expect(audit.json().data).toHaveLength(1);
    expect(audit.json().data[0].datosPrevios).toEqual({
      nombre: 'Nombre Historico',
    });
    expect(audit.json().data[0].datosPosteriores).toEqual({
      nombre: 'Nombre Anterior',
    });
  });

  it('deactivates a user, kills the session it was holding, and files baja_logica', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);
    const objetivoSid = await loginAs(app, objetivo.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/deactivate`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.activo).toBe(false);

    // The session dies as a fact in the table, not merely as a property of
    // findValid's join (D10).
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sid: objetivoSid },
    });
    expect(me.statusCode).toBe(401);

    const rows = await auditRowsFor(objetivo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('baja_logica');
    expect(rows[0]?.datos_previos).toEqual({ activo: true });
    expect(rows[0]?.datos_posteriores).toEqual({ activo: false });
  });

  it('reactivates a user and files reactivar', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    await db
      .update(usuarios)
      .set({ activo: false })
      .where(eq(usuarios.id, objetivo.id));
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/reactivate`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.activo).toBe(true);

    const rows = await auditRowsFor(objetivo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accion).toBe('reactivar');
  });

  it('refuses to deactivate the last active encargado over HTTP and changes nothing', async () => {
    const encargado = await seedUsuario('encargado');
    await seedUsuario('deposito', 'Un Deposito');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${encargado.id}/deactivate`,
      cookies: { sid },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAST_ACTIVE_ENCARGADO');

    // Active deposito users do not count as cover — the guard's predicate is
    // rol AND activo, and this is the shape that proves it over HTTP.
    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, encargado.id));
    expect(row?.activo).toBe(true);
    expect(await auditRowsFor(encargado.id)).toHaveLength(0);
  });

  it('refuses to demote the last active encargado over HTTP and changes nothing', async () => {
    const encargado = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${encargado.id}`,
      payload: { rol: 'deposito' },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAST_ACTIVE_ENCARGADO');

    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, encargado.id));
    expect(row?.rol).toBe('encargado');
    expect(await auditRowsFor(encargado.id)).toHaveLength(0);
  });

  it('writes nothing when a PATCH changes nothing (D5)', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Sin Cambios');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${objetivo.id}`,
      // Same name it already has, and the email differing only in case —
      // both normalise to the stored values.
      payload: { nombre: 'Sin Cambios', email: objetivo.email.toUpperCase() },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(200);
    // `actualizar` names a transition. A row here would answer "who renamed
    // this user" with whoever re-submitted an unchanged form.
    expect(await auditRowsFor(objetivo.id)).toHaveLength(0);
  });

  it('writes nothing when deactivating an already-inactive user (D5)', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Ya Inactivo');
    await db
      .update(usuarios)
      .set({ activo: false })
      .where(eq(usuarios.id, objetivo.id));
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${objetivo.id}/deactivate`,
      cookies: { sid },
    });

    // 200, not 409: the requested end state already holds, so nothing
    // conflicts, and a retry after a dropped response must not look like a
    // failure.
    expect(response.statusCode).toBe(200);
    expect(response.json().usuario.activo).toBe(false);
    expect(await auditRowsFor(objetivo.id)).toHaveLength(0);
  });

  it('rejects an activo key in a PATCH over HTTP', async () => {
    const encargado = await seedUsuario('encargado');
    const objetivo = await seedUsuario('deposito', 'Objetivo');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const sid = await loginAs(app, encargado.email);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${objetivo.id}`,
      payload: { nombre: 'Otro', activo: false },
      cookies: { sid },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, objetivo.id));
    expect(row?.nombre).toBe('Objetivo');
    expect(row?.activo).toBe(true);
  });
});
