import { defineConfig } from 'vitest/config';

// Separate suite so `pnpm test` (unit) never requires Postgres. Run via
// `pnpm test:integration` against a live Docker/Neon database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Every suite here shares ONE database, and several truncate the same
    // tables in beforeEach to get a clean fixture. Under vitest's default
    // file parallelism those truncates interleave, so one file wipes rows
    // another file just inserted and the run fails at random (~50%). The
    // database is the shared resource these tests cannot isolate, so the
    // files must run one at a time. Revisit only by giving each file its
    // own schema or database, never by re-enabling parallelism alone.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        'postgres://inventienda:inventienda@localhost:5432/inventienda',
    },
  },
});
