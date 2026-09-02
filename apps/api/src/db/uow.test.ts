import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from './client.js';
import { createUnitOfWork } from './uow.js';

// Unit-level (fake tx): proves the SQL shape and control-flow contract of
// `TxControl.savepoint` (design.md D1/D2) without a real Postgres
// connection — the ROLLBACK/RELEASE ordering and the never-rethrow
// guarantee are provable from the sequence of `execute` calls alone. The
// real-Postgres proof of C1 (an evaluator failure not rolling back the
// outer transaction) lives in the integration suite (Phase 2, 2.9).
function fakeDb(txExecute: ReturnType<typeof vi.fn>) {
  const tx = { execute: txExecute } as unknown as DbExecutor;
  const transaction = vi.fn(
    async (work: (tx: DbExecutor) => Promise<unknown>) => work(tx),
  );
  const db = { transaction } as unknown as Parameters<
    typeof createUnitOfWork
  >[0];
  return db;
}

describe('createUnitOfWork — TxControl.savepoint', () => {
  it('runs work inside SAVEPOINT/RELEASE and returns its result on success', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const db = fakeDb(execute);
    const uow = createUnitOfWork(db);

    const result = await uow.run(async (_repos, tx) =>
      tx.savepoint('alertas', async () => 'ok'),
    );

    expect(result).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(2);
    const statements = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]),
    );
    expect(statements[0]).toContain('"SAVEPOINT "');
    expect(statements[1]).toContain('"RELEASE SAVEPOINT "');
  });

  it('on failure runs ROLLBACK TO SAVEPOINT then RELEASE SAVEPOINT and returns undefined, never re-throwing', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const db = fakeDb(execute);
    const uow = createUnitOfWork(db);

    const result = await uow.run(async (_repos, tx) =>
      tx.savepoint('alertas', async () => {
        throw new Error('boom: simulated evaluator failure');
      }),
    );

    expect(result).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
    const statements = execute.mock.calls.map((call) =>
      JSON.stringify(call[0]),
    );
    expect(statements[0]).toContain('"SAVEPOINT "');
    expect(statements[1]).toContain('"ROLLBACK TO SAVEPOINT "');
    expect(statements[2]).toContain('"RELEASE SAVEPOINT "');
  });

  it('passes the savepoint name through sql.identifier, never string-interpolated', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const db = fakeDb(execute);
    const uow = createUnitOfWork(db);

    await uow.run(async (_repos, tx) =>
      tx.savepoint('alertas', async () => 'ok'),
    );

    const firstStatement = execute.mock.calls[0]?.[0];
    // sql.identifier renders as its OWN query chunk (`{"value":"alertas"}`,
    // a bare string) distinct from the literal text chunks (which are
    // always `{"value":[...]}`, an array) — proving the name was passed
    // through the identifier path, never concatenated into the literal SQL
    // text.
    expect(JSON.stringify(firstStatement)).toContain('{"value":"alertas"}');
  });
});
