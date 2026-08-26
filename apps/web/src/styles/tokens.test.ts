import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

/**
 * jsdom never applies a CSS Module's stylesheet, so `getComputedStyle` on a
 * rendered screen reports nothing useful, and vitest resolves `?raw` CSS
 * imports to an empty string. Reading the source from disk is what actually
 * pins the values `docs/design.md` documents and the spec scenarios name.
 *
 * `cwd` is imported from `node:process` rather than read off the global on
 * purpose: tsconfig declares `types: ["vite/client"]` so that app code cannot
 * reach Node APIs by accident, and an explicit module import keeps that narrow
 * — adding @types/node to the package must not hand the whole app a Node
 * global surface it has no business touching.
 *
 * Paths are resolved from the package root — vitest runs with `apps/web` as
 * its working directory, both locally and under `pnpm -r test` in CI.
 */
function readStyles(relativePath: string): string {
  return readFileSync(resolve(cwd(), relativePath), 'utf8');
}

const tokens = readStyles('src/styles/tokens.css');
const authCard = readStyles('src/components/ui/AuthCard.module.css');

describe('design tokens', () => {
  it('defines the documented login background', () => {
    expect(tokens).toMatch(/--color-sidebar:\s*#16233c;/);
  });

  it('paints the auth screen with that token rather than a literal', () => {
    expect(authCard).toMatch(
      /\.screen\s*\{[^}]*background:\s*var\(--color-sidebar\)/,
    );
  });

  it('keeps the login card on the modal shadow, not the card shadow', () => {
    // Documented deviation: the 7%-opacity card shadow is invisible against
    // the dark #16233c field, so the login card borrows the modal shadow.
    expect(tokens).toMatch(
      /--shadow-modal:\s*0 18px 50px rgba\(22,\s*35,\s*60,\s*0?\.4\);/,
    );
  });
});
