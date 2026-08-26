import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    // Vitest's 5s default is sized for pure-logic unit tests. These build a
    // real Fastify app per test, and the run's cost is dominated by cold-start
    // module import — 76s of import time across one contended run.
    //
    // Diagnosed, not guessed: finding F2 was a one-off failure of the login
    // Set-Cookie test that nobody could explain. Reproduced deliberately by
    // running this suite against 16 busy loops on 8 cores — 1 failure in 12
    // runs, and the captured output was `Error: Test timed out in 5000ms.`,
    // never an assertion failure. The openapi test, which does no argon2 at
    // all, timed out in the same run at 6306ms, so slow hashing is NOT the
    // special cause: any test here can exceed 5s under CPU starvation.
    //
    // 15s is ~2.4x the worst observed. Raising this cannot hide a logic bug —
    // every assertion still runs unchanged, and a genuine hang still fails.
    // CI runs on a smaller runner than a dev laptop, so it is the more likely
    // place to hit this.
    testTimeout: 15_000,
  },
});
