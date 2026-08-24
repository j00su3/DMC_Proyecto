import { defineConfig } from 'vitest/config';

// Separate suite so `pnpm test` (unit) never requires Postgres. Run via
// `pnpm test:integration` against a live Docker/Neon database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    env: {
      DATABASE_URL:
        'postgres://inventienda:inventienda@localhost:5432/inventienda',
    },
  },
});
