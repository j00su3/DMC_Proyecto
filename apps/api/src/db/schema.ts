// Drizzle schema for @inventienda/api.
//
// First real domain tables (backlog #2, auth-sesiones): `usuarios` and
// `sesiones`. See design.md D3-D6 for the field/type decisions.
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
});

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
