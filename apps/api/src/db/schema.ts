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
