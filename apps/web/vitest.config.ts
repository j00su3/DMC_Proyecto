import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest's 5s default is sized for pure-logic unit tests. These render
    // React through jsdom and drive it with userEvent, which types character
    // by character; one contended run measured 219s of environment setup
    // alone across the suite.
    //
    // Diagnosed, not guessed. `ChangePasswordForm > calls onSubmit with the
    // entered values on a valid submit` failed at 5188ms against the 5000ms
    // limit with `Error: Test timed out in 5000ms.` — a timeout, never an
    // assertion failure. The output was captured to a file BEFORE any rerun,
    // because a timeout and a failed assertion need opposite fixes.
    //
    // This mirrors the fix already applied to apps/api after finding F2,
    // which was deliberately scoped to that package because web had no
    // evidence of the problem yet. It does now.
    //
    // The NUMBER is measured, not copied from apps/api. The slowest test
    // here runs 7995ms even on an idle machine — already 60% past the 5s
    // default, where api's slowest was 4956ms. 15s would leave web only
    // 1.9x headroom against api's 3.0x, so it gets 25s for a comparable
    // margin. Raising this cannot hide a logic bug: every assertion still
    // runs unchanged and a genuine hang still fails, just 25s later, which
    // is negligible across 53 tests.
    testTimeout: 25_000,
  },
});
