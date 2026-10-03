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
import { hashPassword, verifyPassword } from '../auth/password.js';
import { getDb, getPool } from '../db/pool.js';
import { sesiones, usuarios } from '../db/schema.js';
import { type UnitOfWork, createUnitOfWork } from '../db/uow.js';
import { buildRepos } from '../plugins/repos.js';
import { rescatarEncargado } from './rescate.js';

// Real Postgres, real UnitOfWork. The rescue is an operator script with no
// Fastify around it, so the core is driven directly the way the script wires
// it; the app is built only where a case needs a real login or the audit
// endpoint. COOKIE_SECRET is stubbed OUT in beforeEach: the integration config
// sets one, which would hide the lazy-key behaviour (rescate-encargado D1).
const db = getDb();
const COOKIE_SECRET = 'test-cookie-secret-at-least-32-characters-long';
const PASSWORD = 'correct-horse-battery-staple';

async function seedUsuario(
  rol: 'encargado' | 'deposito',
  over: {
    nombre?: string;
    email?: string;
    activo?: boolean;
    debeCambiarPassword?: boolean;
    intentosFallidos?: number;
    bloqueadoHasta?: Date;
  } = {},
) {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: over.nombre ?? 'Seed User',
      email: over.email ?? `rescate-${randomUUID()}@example.com`,
      hashContrasena: await hashPassword(PASSWORD),
      rol,
      activo: over.activo ?? true,
      debeCambiarPassword: over.debeCambiarPassword ?? false,
      intentosFallidos: over.intentosFallidos ?? 0,
      bloqueadoHasta: over.bloqueadoHasta ?? null,
    })
    .returning();
  if (!row) {
    throw new Error('seedUsuario: expected exactly one row back');
  }
  return row;
}

async function seedSesion(usuarioId: string) {
  await db.insert(sesiones).values({
    id: randomUUID(),
    usuarioId,
    expiraEn: new Date(Date.now() + 3_600_000),
  });
}

async function lockOut(id: string) {
  await db
    .update(usuarios)
    .set({
      intentosFallidos: 5,
      bloqueadoHasta: new Date(Date.now() + 300_000),
    })
    .where(eq(usuarios.id, id));
}

async function count(table: 'auditoria' | 'sesiones' | 'usuarios') {
  const result = await db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? -1;
}

async function sessionCount(usuarioId: string) {
  const result = await db.execute(
    sql`select count(*)::int as n from sesiones where usuario_id = ${usuarioId}`,
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]?.n ?? -1;
}

async function auditRows(entidadId: string) {
  const result = await db.execute(
    sql`select entidad, accion, entidad_id, usuario_id, datos_previos, datos_posteriores
          from auditoria where entidad_id = ${entidadId} order by creado_en`,
  );
  return (
    result as unknown as {
      rows: {
        entidad: string;
        accion: string;
        entidad_id: string;
        usuario_id: string;
        datos_previos: Record<string, unknown> | null;
        datos_posteriores: Record<string, unknown>;
      }[];
    }
  ).rows;
}

// Everything a refusal or a dry run must leave untouched: the full usuarios
// rows (hash, flags, lockout, activo), plus the session and audit counts.
async function snapshot() {
  return {
    usuarios: await db.select().from(usuarios).orderBy(usuarios.id),
    sesiones: await count('sesiones'),
    auditoria: await count('auditoria'),
  };
}

function rescue(email: string, confirmar: boolean, uow?: UnitOfWork) {
  return rescatarEncargado(buildRepos(db), uow ?? createUnitOfWork(db), {
    email,
    confirmar,
  });
}

async function rescued(email: string, uow?: UnitOfWork) {
  const result = await rescue(email, true, uow);
  if (result.estado !== 'rescatado') {
    throw new Error(`expected a rescue, got ${JSON.stringify(result)}`);
  }
  return result;
}

// The rescue audit row, asserted exactly: same shape with or without the key.
function expectRescueRow(
  rows: Awaited<ReturnType<typeof auditRows>>,
  targetId: string,
) {
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.entidad).toBe('usuarios');
  expect(row?.accion).toBe('cambiar_password');
  expect(row?.entidad_id).toBe(targetId);
  expect(row?.usuario_id).toBe(targetId);
  expect(row?.datos_posteriores).toEqual({
    debeCambiarPassword: true,
    intentosFallidos: 0,
    bloqueadoHasta: null,
    origen: 'rescate',
  });
  expect(row?.datos_previos).not.toHaveProperty('origen');
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
// finishes, so closing the pool inside one describe kills it for the rest.
afterAll(async () => {
  await getPool().end();
});

describe('rescatarEncargado (integration, real Postgres, no COOKIE_SECRET)', () => {
  beforeEach(async () => {
    vi.stubEnv('COOKIE_SECRET', undefined);
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('I1: rescues a locked encargado, replaces the credential and files one marked row', async () => {
    const target = await seedUsuario('encargado');
    const other = await seedUsuario('deposito');
    await lockOut(target.id);
    await seedSesion(target.id);
    await seedSesion(other.id);

    const result = await rescued(target.email);

    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, target.id));
    expect(row?.hashContrasena).not.toBe(target.hashContrasena);
    expect(
      await verifyPassword(row?.hashContrasena ?? '', result.passwordTemporal),
    ).toBe(true);
    expect(await verifyPassword(row?.hashContrasena ?? '', PASSWORD)).toBe(
      false,
    );
    expect(row?.debeCambiarPassword).toBe(true);
    expect(row?.intentosFallidos).toBe(0);
    expect(row?.bloqueadoHasta).toBeNull();
    // Only the target's sessions die.
    expect(await sessionCount(target.id)).toBe(0);
    expect(await sessionCount(other.id)).toBe(1);

    const rows = await auditRows(target.id);
    expectRescueRow(rows, target.id);
    // No secret in any column that exists: not the hash, not the email, not
    // the temporary password.
    const everything = JSON.stringify([
      await db.select().from(usuarios),
      await db.select().from(sesiones),
      (await db.execute(sql`select * from auditoria`)).rows,
    ]);
    expect(JSON.stringify(rows)).not.toContain('hashContrasena');
    expect(JSON.stringify(rows)).not.toContain(target.hashContrasena);
    expect(JSON.stringify(rows)).not.toContain(row?.hashContrasena);
    expect(JSON.stringify(rows)).not.toContain(target.email);
    expect(JSON.stringify(rows)).not.toContain(result.passwordTemporal);
    expect(everything).not.toContain(result.passwordTemporal);
  });

  it('I1: rotates the credential of an already-flagged, unlocked account and files one row', async () => {
    const target = await seedUsuario('encargado', {
      debeCambiarPassword: true,
    });

    const result = await rescued(target.email);

    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, target.id));
    expect(row?.hashContrasena).not.toBe(target.hashContrasena);
    expect(
      await verifyPassword(row?.hashContrasena ?? '', result.passwordTemporal),
    ).toBe(true);
    expect(await auditRows(target.id)).toHaveLength(1);
  });

  it('rescuing twice prints two passwords and only the second one works', async () => {
    const target = await seedUsuario('encargado');

    const first = await rescued(target.email);
    const second = await rescued(target.email);

    expect(second.passwordTemporal).not.toBe(first.passwordTemporal);
    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, target.id));
    const hash = row?.hashContrasena ?? '';
    expect(await verifyPassword(hash, second.passwordTemporal)).toBe(true);
    expect(await verifyPassword(hash, first.passwordTemporal)).toBe(false);
    expect(await auditRows(target.id)).toHaveLength(2);
  });

  it.each([
    [
      'I2: unknown email',
      'no_encontrado',
      async (): Promise<string> => {
        await seedUsuario('encargado');
        return 'nadie@example.com';
      },
    ],
    [
      'I3: a deposito user',
      'no_es_encargado',
      async () => {
        const deposito = await seedUsuario('deposito', {
          intentosFallidos: 3,
        });
        await seedSesion(deposito.id);
        return deposito.email;
      },
    ],
    [
      'I4: an inactive encargado',
      'inactivo',
      async () => {
        const inactivo = await seedUsuario('encargado', { activo: false });
        await seedSesion(inactivo.id);
        return inactivo.email;
      },
    ],
    [
      'a stored mixed-case email',
      'no_encontrado',
      async (): Promise<string> => {
        await seedUsuario('encargado', { email: 'Admin@Tienda.com' });
        return 'Admin@Tienda.com';
      },
    ],
  ] as const)(
    '%s is refused and the database does not change',
    async (_label, motivo, arrange) => {
      const email = await arrange();
      const before = await snapshot();

      const result = await rescue(email, true);

      expect(result).toEqual({ estado: 'rechazado', motivo });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('I4: an inactive encargado stays inactive', async () => {
    const inactivo = await seedUsuario('encargado', { activo: false });

    await rescue(inactivo.email, true);

    const [row] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, inactivo.id));
    expect(row?.activo).toBe(false);
  });

  it('I5: a dry run on a valid target reports it and the database does not change', async () => {
    const target = await seedUsuario('encargado', { nombre: 'Ana Encargada' });
    await lockOut(target.id);
    await seedSesion(target.id);
    const before = await snapshot();

    const result = await rescue(target.email, false);

    expect(result).toEqual({
      estado: 'simulado',
      objetivo: { id: target.id, nombre: 'Ana Encargada', email: target.email },
      hayOtroEncargadoActivo: false,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('I6: rolls back the whole rescue when the audit write fails', async () => {
    const target = await seedUsuario('encargado');
    await lockOut(target.id);
    await seedSesion(target.id);
    const before = await snapshot();

    // A REAL transaction whose audit repo throws: the usuarios UPDATE and the
    // session delete are genuine Postgres writes, only the audit fails, so the
    // ROLLBACK under test is the real one.
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

    await expect(rescue(target.email, true, failingUow)).rejects.toMatchObject({
      code: 'AUDIT_WRITE_FAILED',
    });

    // Hash, flag, lockout, session row and audit table: all as before.
    expect(await snapshot()).toEqual(before);
    expect(await sessionCount(target.id)).toBe(1);
  });

  it('I7: counts only active encargados', async () => {
    await seedUsuario('encargado');
    await seedUsuario('encargado', { activo: false });
    await seedUsuario('deposito');
    expect(await buildRepos(db).usuarios.countActiveEncargados()).toBe(1);

    await seedUsuario('encargado');
    expect(await buildRepos(db).usuarios.countActiveEncargados()).toBe(2);
  });

  it('rescues one encargado alongside another active one and leaves the other alone', async () => {
    const a = await seedUsuario('encargado');
    const b = await seedUsuario('encargado');
    await seedSesion(b.id);
    const [bBefore] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, b.id));

    const result = await rescued(a.email);

    expect(result.hayOtroEncargadoActivo).toBe(true);
    const [bAfter] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, b.id));
    expect(bAfter).toEqual(bBefore);
    expect(await sessionCount(b.id)).toBe(1);
    expect(await auditRows(b.id)).toHaveLength(0);
  });

  it('gives a sole active encargado no other-encargado notice', async () => {
    const a = await seedUsuario('encargado');
    await seedUsuario('encargado', { activo: false });

    const result = await rescued(a.email);

    expect(result.hayOtroEncargadoActivo).toBe(false);
  });
});

describe('rescatarEncargado through the app (integration, real Postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeEach(async () => {
    vi.stubEnv('COOKIE_SECRET', undefined);
    await db.execute(sql`truncate table auditoria, sesiones, usuarios cascade`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app?.close();
    app = undefined;
  });

  it('lets the rescued encargado log in at once, kills every old session and exposes the marker', async () => {
    const target = await seedUsuario('encargado');
    const reader = await seedUsuario('encargado');
    app = await buildApp({ cookieSecret: COOKIE_SECRET });
    await app.ready();
    const oldSid1 = await loginAs(app, target.email);
    const oldSid2 = await loginAs(app, target.email);
    const readerSid = await loginAs(app, reader.email);
    await lockOut(target.id);

    const result = await rescued(target.email);

    // 200, not 423: the lockout was cleared in the same transaction.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: target.email, password: result.passwordTemporal },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().usuario.debeCambiarPassword).toBe(true);

    for (const sid of [oldSid1, oldSid2]) {
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { sid },
      });
      expect(me.statusCode).toBe(401);
    }

    // The marker survives the read DTO unmodified. Read as the OTHER
    // encargado: the rescued one is gated behind a password change.
    const audit = await app.inject({
      method: 'GET',
      url: `/api/auditoria?entidad=usuarios&entidadId=${target.id}`,
      cookies: { sid: readerSid },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data).toHaveLength(1);
    expect(audit.json().data[0].datosPosteriores.origen).toBe('rescate');
  });

  it('files the same row shape when COOKIE_SECRET is set', async () => {
    vi.stubEnv('COOKIE_SECRET', COOKIE_SECRET);
    const target = await seedUsuario('encargado');
    await lockOut(target.id);

    await rescued(target.email);

    expectRescueRow(await auditRows(target.id), target.id);
  });
});
