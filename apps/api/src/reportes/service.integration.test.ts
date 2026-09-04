import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAlertasRepo } from '../alertas/repository.js';
import { getDb, getPool } from '../db/pool.js';
import { movimientos, productos, proveedores, usuarios } from '../db/schema.js';
import { DrizzleMovimientosRepo } from '../movimientos/repository.js';
import { DrizzleProductosRepo } from '../productos/repository.js';
import { type ReadRepos, listarMovimientosPeriodo } from './service.js';

// Real Docker Postgres suite (see vitest.integration.config.ts). This is the
// LOAD-BEARING test for #12 (design.md D3, tasks.md 3.3): the first
// row-level (non-role) authorization filter in this codebase. A fake repo
// cannot honestly prove cross-actor row isolation — only a real query
// against real rows can.
const db = getDb();
const repos: ReadRepos = {
  movimientos: new DrizzleMovimientosRepo(db),
  productos: new DrizzleProductosRepo(db),
  alertas: new DrizzleAlertasRepo(db),
};

async function insertProveedor() {
  const [row] = await db
    .insert(proveedores)
    .values({ nombre: `Proveedor ${randomUUID()}` })
    .returning();
  if (!row) {
    throw new Error('insertProveedor: expected exactly one row back');
  }
  return row;
}

async function insertUsuario() {
  const [row] = await db
    .insert(usuarios)
    .values({
      nombre: 'Test User',
      email: `reportes-test-${randomUUID()}@example.com`,
      hashContrasena: 'irrelevant-for-this-test',
      rol: 'deposito',
    })
    .returning();
  if (!row) {
    throw new Error('insertUsuario: expected exactly one row back');
  }
  return row;
}

async function insertProducto(proveedorId: string) {
  const [row] = await db
    .insert(productos)
    .values({
      nombre: `Producto ${randomUUID()}`,
      sku: `SKU-${randomUUID()}`,
      precio: '10.00',
      proveedorId,
    })
    .returning();
  if (!row) {
    throw new Error('insertProducto: expected exactly one row back');
  }
  return row;
}

async function insertMovimiento(overrides: {
  usuarioId: string;
  productoId: string;
  fecha: Date;
}) {
  await db.insert(movimientos).values({
    productoId: overrides.productoId,
    usuarioId: overrides.usuarioId,
    tipo: 'entrada',
    cantidad: 1,
    stockResultante: 1,
    fecha: overrides.fecha,
  });
}

describe('reportes/service.ts listarMovimientosPeriodo (integration, real Postgres)', () => {
  let productoId: string;
  let usuarioA: string;
  let usuarioB: string;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table movimientos, productos, proveedores, usuarios, alertas cascade`,
    );
    const proveedor = await insertProveedor();
    productoId = (await insertProducto(proveedor.id)).id;
    usuarioA = (await insertUsuario()).id;
    usuarioB = (await insertUsuario()).id;
  });

  afterAll(async () => {
    await getPool().end();
  });

  const fechaDesde = new Date('2026-02-01T00:00:00.000Z');
  const fechaHasta = new Date('2026-02-10T00:00:00.000Z');

  // spec.md "Movimientos — Deposito Row-Level Scope" / "Deposito sees only
  // their own movimientos" and "Query parameters cannot override the scope".
  it("returns only deposito A's movimientos, never deposito B's, and B's id has no effect because the input shape structurally has no field to carry it", async () => {
    await insertMovimiento({
      usuarioId: usuarioA,
      productoId,
      fecha: new Date('2026-02-05T00:00:00.000Z'),
    });
    await insertMovimiento({
      usuarioId: usuarioB,
      productoId,
      fecha: new Date('2026-02-06T00:00:00.000Z'),
    });

    // Structural assertion: ListarMovimientosPeriodoInput has no field for a
    // client-supplied actor/usuarioId — TypeScript would reject this object
    // literal at compile time if such a field existed and were required, and
    // there is simply nowhere to place B's id below.
    const result = await listarMovimientosPeriodo(repos, {
      fechaDesde,
      fechaHasta,
      page: 1,
      pageSize: 20,
      actor: { id: usuarioA, rol: 'deposito' },
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows.every((row) => row.usuarioId === usuarioA)).toBe(true);
    expect(result.rows.some((row) => row.usuarioId === usuarioB)).toBe(false);
  });

  // spec.md "Movimientos — Encargado Scope" / "Encargado sees all actors"
  // (tasks.md 3.4).
  it("returns movimientos from more than one actor for an encargado's request", async () => {
    await insertMovimiento({
      usuarioId: usuarioA,
      productoId,
      fecha: new Date('2026-02-05T00:00:00.000Z'),
    });
    await insertMovimiento({
      usuarioId: usuarioB,
      productoId,
      fecha: new Date('2026-02-06T00:00:00.000Z'),
    });

    const result = await listarMovimientosPeriodo(repos, {
      fechaDesde,
      fechaHasta,
      page: 1,
      pageSize: 20,
      actor: { id: usuarioA, rol: 'encargado' },
    });

    expect(result.total).toBe(2);
    const actores = result.rows.map((row) => row.usuarioId).sort();
    expect(actores).toEqual([usuarioA, usuarioB].sort());
  });
});
