import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import {
  parseArgs,
  resolveSeedInput,
  seedEncargado,
} from './seed-encargado.js';

// Interface-shape tests over an injected fake Db, mirroring
// `auth/repository.test.ts`'s fake-chain pattern. Real transaction/SQL
// semantics belong to `db:migrate` + manual verification (task 5.6), not
// here — this script is human-invoked, not part of the automated suite.
function createFakeDb(existingEncargadoRows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => existingEncargadoRows),
    insert: vi.fn(() => chain),
    values: vi.fn((_values: { hashContrasena: string }) => chain),
    onConflictDoNothing: vi.fn(async (_opts: { target: unknown }) => undefined),
  };
  const db = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(chain),
    ),
  };
  return { db: db as unknown as Db, chain };
}

const validInput = {
  email: 'admin@example.com',
  nombre: 'Admin',
  password: 'correct-horse-battery-staple',
};

describe('seedEncargado', () => {
  it('creates exactly one encargado row with a hashed password on first run', async () => {
    const { db, chain } = createFakeDb([]);

    const result = await seedEncargado(db, validInput);

    expect(result.created).toBe(true);
    expect(result.email).toBe(validInput.email);
    expect(result.rol).toBe('encargado');
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const insertedValues = chain.values.mock.calls[0]?.[0];
    expect(insertedValues?.hashContrasena).not.toBe(validInput.password);
  });

  it('refuses to run and does not insert when an encargado already exists', async () => {
    const { db, chain } = createFakeDb([{ id: 'existing-id' }]);

    const result = await seedEncargado(db, validInput);

    expect(result.created).toBe(false);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it('does not duplicate a user for the same email on a same-input re-invocation', async () => {
    const { db, chain } = createFakeDb([]);

    await seedEncargado(db, validInput);
    await seedEncargado(db, validInput);

    expect(chain.onConflictDoNothing).toHaveBeenCalledTimes(2);
    for (const call of chain.onConflictDoNothing.mock.calls) {
      expect(call[0]).toMatchObject({ target: expect.anything() });
    }
  });
});

describe('parseArgs', () => {
  it('rejects a password passed as a CLI argument', () => {
    expect(() => parseArgs(['--password', 'hunter2'])).toThrow(
      /Refusing to accept a password via CLI argument/,
    );
    expect(() => parseArgs(['-p', 'hunter2'])).toThrow(
      /Refusing to accept a password via CLI argument/,
    );
  });

  it('accepts --email and --nombre overrides', () => {
    const overrides = parseArgs([
      '--email',
      'override@example.com',
      '--nombre',
      'Override Name',
    ]);
    expect(overrides).toEqual({
      email: 'override@example.com',
      nombre: 'Override Name',
    });
  });
});

describe('resolveSeedInput', () => {
  it('reads credentials from process.env and validates them', () => {
    const env = {
      SEED_ENCARGADO_EMAIL: 'env@example.com',
      SEED_ENCARGADO_NOMBRE: 'Env Name',
      SEED_ENCARGADO_PASSWORD: 'correct-horse-battery-staple',
    } as NodeJS.ProcessEnv;

    const input = resolveSeedInput(env, []);

    expect(input).toEqual({
      email: 'env@example.com',
      nombre: 'Env Name',
      password: 'correct-horse-battery-staple',
    });
  });

  it('lets --email/--nombre override the env values', () => {
    const env = {
      SEED_ENCARGADO_EMAIL: 'env@example.com',
      SEED_ENCARGADO_NOMBRE: 'Env Name',
      SEED_ENCARGADO_PASSWORD: 'correct-horse-battery-staple',
    } as NodeJS.ProcessEnv;

    const input = resolveSeedInput(env, ['--email', 'override@example.com']);

    expect(input.email).toBe('override@example.com');
    expect(input.nombre).toBe('Env Name');
  });

  it('rejects a password shorter than 12 characters', () => {
    const env = {
      SEED_ENCARGADO_EMAIL: 'env@example.com',
      SEED_ENCARGADO_NOMBRE: 'Env Name',
      SEED_ENCARGADO_PASSWORD: 'short',
    } as NodeJS.ProcessEnv;

    expect(() => resolveSeedInput(env, [])).toThrow();
  });

  it('never resolves a password from a CLI argument', () => {
    expect(() =>
      resolveSeedInput({} as NodeJS.ProcessEnv, ['--password', 'hunter2']),
    ).toThrow(/Refusing to accept a password via CLI argument/);
  });
});
