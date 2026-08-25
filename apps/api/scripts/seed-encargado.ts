import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword } from '../src/auth/password.js';
import type { Db } from '../src/db/client.js';
import { getDb } from '../src/db/pool.js';
import { usuarios } from '../src/db/schema.js';

// Out-of-band bootstrap for the first `encargado` user (design.md "Bootstrap
// Encargado Script"). Human-invoked, not part of the API — the user-management
// API requires an authenticated encargado to use it, so the very first one
// must exist before that becomes possible.

const PASSWORD_ARGV_FLAGS = ['--password', '--seed-encargado-password', '-p'];

const seedInputSchema = z.object({
  email: z.string().email(),
  nombre: z.string().min(1),
  // The password is never accepted via CLI argument (it would leak into
  // shell history and process listings) — env only.
  password: z.string().min(12),
});

export type SeedInput = z.infer<typeof seedInputSchema>;

export interface SeedResult {
  created: boolean;
  email: string;
  rol: 'encargado';
}

export function parseArgs(argv: string[]): { email?: string; nombre?: string } {
  for (const flag of PASSWORD_ARGV_FLAGS) {
    if (argv.includes(flag)) {
      throw new Error(
        `Refusing to accept a password via CLI argument (${flag}). Set SEED_ENCARGADO_PASSWORD in the environment instead.`,
      );
    }
  }

  const overrides: { email?: string; nombre?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') overrides.email = argv[i + 1];
    if (argv[i] === '--nombre') overrides.nombre = argv[i + 1];
  }
  return overrides;
}

export function resolveSeedInput(
  env: NodeJS.ProcessEnv,
  argv: string[],
): SeedInput {
  const overrides = parseArgs(argv);
  return seedInputSchema.parse({
    email: overrides.email ?? env.SEED_ENCARGADO_EMAIL,
    nombre: overrides.nombre ?? env.SEED_ENCARGADO_NOMBRE,
    password: env.SEED_ENCARGADO_PASSWORD,
  });
}

// One transaction: refuse if any `encargado` already exists, otherwise
// insert with `onConflictDoNothing()` on email as a race-safety net for two
// concurrent invocations (design.md "Seed script").
export async function seedEncargado(
  db: Db,
  input: SeedInput,
): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.rol, 'encargado'))
      .limit(1);

    if (existing.length > 0) {
      return { created: false, email: input.email, rol: 'encargado' as const };
    }

    const hashContrasena = await hashPassword(input.password);
    await tx
      .insert(usuarios)
      .values({
        nombre: input.nombre,
        email: input.email,
        hashContrasena,
        rol: 'encargado',
      })
      .onConflictDoNothing({ target: usuarios.email });

    return { created: true, email: input.email, rol: 'encargado' as const };
  });
}

async function main() {
  const input = resolveSeedInput(process.env, process.argv.slice(2));
  const db = getDb();
  const result = await seedEncargado(db, input);

  if (result.created) {
    // Never log the password or the hash — email and role only.
    console.log(`Created encargado user: ${result.email} (rol=${result.rol})`);
  } else {
    console.log('An encargado user already exists; nothing to do.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
