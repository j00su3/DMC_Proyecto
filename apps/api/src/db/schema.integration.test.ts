import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, getPool } from './pool.js';
import { proveedores } from './schema.js';

// Real Docker Postgres suite. Proves the D1 functional unique index is only
// truly provable against a real database, never against a fake: Postgres
// itself must fold `lower(nombre)` and raise 23505 on the collision, and the
// stored value must survive untouched — no fake pool can assert either.
const db = getDb();

async function insertProveedor(overrides: {
  nombre: string;
  activo?: boolean;
}) {
  return db
    .insert(proveedores)
    .values({
      nombre: overrides.nombre,
      activo: overrides.activo ?? true,
    })
    .returning();
}

describe('proveedores schema (integration, real Postgres)', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table proveedores cascade`);
  });

  afterAll(async () => {
    await getPool().end();
  });

  describe('D1 — proveedores_nombre_lower_unique', () => {
    it('raises 23505 on a case-differing duplicate name', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      await expect(
        insertProveedor({ nombre: 'distribuidora norte' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('raises 23505 on an all-uppercase duplicate name', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      await expect(
        insertProveedor({ nombre: 'DISTRIBUIDORA NORTE' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('stores the original casing exactly — never lowercased or altered', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte' });

      const [row] = await db
        .select({ nombre: proveedores.nombre })
        .from(proveedores);

      expect(row?.nombre).toBe('Distribuidora Norte');
    });

    it('an inactive row still blocks a case-differing duplicate', async () => {
      await insertProveedor({ nombre: 'Distribuidora Norte', activo: false });

      await expect(
        insertProveedor({ nombre: 'DISTRIBUIDORA NORTE' }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    // Measured on this container 2026-08-28: datcollate = datctype =
    // en_US.utf8, and lower('ÑANDÚ') = 'ñandú' is true — so this accented
    // pair collides. Asserted against the database's actual behaviour, not
    // assumed (design.md Open Question 1).
    it('folds the accented pair Ñandú / ñandú under this collation, so it also collides', async () => {
      await insertProveedor({ nombre: 'Ñandú' });

      await expect(insertProveedor({ nombre: 'ñandú' })).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    });
  });
});
