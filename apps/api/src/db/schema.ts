// Drizzle schema for @inventienda/api.
//
// First real domain tables (backlog #2, auth-sesiones): `usuarios` and
// `sesiones`. See design.md D3-D6 for the field/type decisions.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const rolUsuario = pgEnum('rol_usuario', ['encargado', 'deposito']);

export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  email: text('email').notNull().unique(),
  hashContrasena: text('hash_contrasena').notNull(),
  rol: rolUsuario('rol').notNull(),
  activo: boolean('activo').notNull().default(true),
  intentosFallidos: integer('intentos_fallidos').notNull().default(0),
  bloqueadoHasta: timestamp('bloqueado_hasta', {
    withTimezone: true,
    mode: 'date',
  }),
  creadoEn: timestamp('creado_en', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  debeCambiarPassword: boolean('debe_cambiar_password')
    .notNull()
    .default(false),
});

// Supplier directory (backlog #4). See design.md D1-D3: case-insensitive
// name uniqueness is a functional unique index on lower(nombre), never a
// generated column or TS-side case folding — the column stays plain text so
// the stored value is exactly what was submitted (D2). `text`, not
// `varchar` — a varchar column makes Postgres add a `::text` cast to the
// index expression that a later query predicate would then fail to match.
export const proveedores = pgTable(
  'proveedores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    contacto: text('contacto'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The name is mandatory, not stylistic: drizzle-kit exits 1 on an
    // unnamed expression index (design.md D1).
    uniqueIndex('proveedores_nombre_lower_unique').on(
      sql`lower(${table.nombre})`,
    ),
  ],
);

export const sesiones = pgTable(
  'sesiones',
  {
    id: text('id').primaryKey(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    creadaEn: timestamp('creada_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    expiraEn: timestamp('expira_en', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
  },
  (table) => [index('sesiones_usuario_id_idx').on(table.usuarioId)],
);

// Record-change trail (backlog #2.2). See design.md D7-D14. Separate from
// the `movimientos` stock ledger per ADR-0012 — never named `historial`.
export const accionAuditoria = pgEnum('accion_auditoria', [
  'crear',
  'actualizar',
  'baja_logica',
  'reactivar',
  'cambiar_password',
]);

export const entidadAuditoria = pgEnum('entidad_auditoria', [
  'usuarios',
  'proveedores',
  'productos',
]);

export const auditoria = pgTable(
  'auditoria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entidad: entidadAuditoria('entidad').notNull(),
    // No foreign key: `entidad_id` is polymorphic (ADR-0011). The trail must
    // survive deletion of the entity it describes.
    entidadId: uuid('entidad_id').notNull(),
    accion: accionAuditoria('accion').notNull(),
    // The actor. Unlike `entidad_id`, this always resolves to a `usuarios`
    // row, so it carries a real FK (design.md D14).
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'restrict' }),
    // NULL iff `accion = 'crear'` — enforced by the CHECK below (design.md D7).
    datosPrevios: jsonb('datos_previos'),
    datosPosteriores: jsonb('datos_posteriores').notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auditoria_entidad_entidad_id_creado_en_idx').on(
      table.entidad,
      table.entidadId,
      table.creadoEn,
    ),
    index('auditoria_usuario_id_creado_en_idx').on(
      table.usuarioId,
      table.creadoEn,
    ),
    check(
      'auditoria_datos_previos_solo_en_crear',
      sql`(${table.accion} = 'crear'::accion_auditoria) = (${table.datosPrevios} is null)`,
    ),
  ],
);

// Product catalog + stock ledger (backlog #5, ADR-0003, ADR-0012). See
// design.md D1-D9 and tasks.md's RECONCILE section for R2/R3/R4:
// - R3 (owner decision 2026-08-29): proveedorId is NOT NULL — every product
//   carries a supplier.
// - R4 (resolved by spec — dropped): no
//   `CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL)`. spec.md's own count
//   names exactly two CHECK constraints on `movimientos`; #6 owns the motivo
//   rule.
// No `cantidad <> 0` CHECK either — design's own resolved Open Question
// (not a RECONCILE item): `ajuste` is deliberately libre
// (TECH-DESIGNv2.md:125).
export const movimientoTipo = pgEnum('movimiento_tipo', [
  'entrada',
  'salida',
  'ajuste',
  'venta',
  'anulacion',
]);

export const productos = pgTable(
  'productos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    sku: text('sku').notNull(),
    categoria: text('categoria'),
    stockActual: integer('stock_actual').notNull().default(0),
    stockMinimo: integer('stock_minimo'),
    precio: numeric('precio', { precision: 12, scale: 2 }).notNull(),
    // R3: NOT NULL, settled by the owner 2026-08-29 (spec silent — see
    // tasks.md's RECONCILE section). `onDelete: 'restrict'` matches
    // proveedores' own FK style — a supplier with products cannot be
    // hard-deleted (suppliers are only ever deactivated, never deleted).
    proveedorId: uuid('proveedor_id')
      .notNull()
      .references(() => proveedores.id, { onDelete: 'restrict' }),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Same functional-unique-index technique as proveedores_nombre_lower_unique
    // (design.md D1 precedent): the column keeps the value exactly as
    // submitted, only the index expression folds case.
    uniqueIndex('productos_sku_lower_unique').on(sql`lower(${table.sku})`),
  ],
);

export const movimientos = pgTable(
  'movimientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => productos.id, { onDelete: 'restrict' }),
    tipo: movimientoTipo('tipo').notNull(),
    cantidad: integer('cantidad').notNull(),
    motivo: text('motivo'),
    esDiscrepancia: boolean('es_discrepancia').notNull().default(false),
    // backlog #6 (movimientos-inventario) D3 — beside esDiscrepancia,
    // required at the port (movimientos/repository.ts), defaulted here only
    // so the migration is additive against existing rows.
    esMerma: boolean('es_merma').notNull().default(false),
    // No FK to a `usuarios` row is omitted here — the actor who performed
    // the movement. Nullable would hide who made a stock change; kept
    // required and referencing usuarios, mirroring auditoria.usuarioId.
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'restrict' }),
    fecha: timestamp('fecha', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    // No FK — `ventas` does not exist until backlog #7.
    ventaId: uuid('venta_id'),
    stockResultante: integer('stock_resultante').notNull(),
  },
  (table) => [
    index('movimientos_producto_id_fecha_idx').on(
      table.productoId,
      table.fecha,
    ),
    check(
      'movimientos_signo_tipo',
      sql`(
        (${table.tipo} = 'entrada'::movimiento_tipo AND ${table.cantidad} > 0) OR
        (${table.tipo} IN ('salida'::movimiento_tipo, 'venta'::movimiento_tipo) AND ${table.cantidad} < 0) OR
        (${table.tipo} = 'anulacion'::movimiento_tipo AND ${table.cantidad} > 0) OR
        (${table.tipo} = 'ajuste'::movimiento_tipo)
      )`,
    ),
    check(
      'movimientos_discrepancia_solo_ajuste',
      sql`${table.esDiscrepancia} = false OR ${table.tipo} = 'ajuste'::movimiento_tipo`,
    ),
    // backlog #6 (movimientos-inventario) D3 — structural mirror of
    // movimientos_discrepancia_solo_ajuste above: same `flag = false OR
    // tipo = …` spelling, same Spanish constraint-name family.
    check(
      'movimientos_merma_solo_salida',
      sql`${table.esMerma} = false OR ${table.tipo} = 'salida'::movimiento_tipo`,
    ),
    check(
      'movimientos_ajuste_cantidad_no_cero',
      sql`${table.tipo} <> 'ajuste'::movimiento_tipo OR ${table.cantidad} <> 0`,
    ),
  ],
);
