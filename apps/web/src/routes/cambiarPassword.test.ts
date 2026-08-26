import { describe, expect, it } from 'vitest';
import { authLayout } from './authLayout.js';
import { cambiarPasswordRoute } from './cambiarPassword.js';

/**
 * The route must NOT declare its own `beforeLoad` with a forced-change
 * redirect: it is the one screen a flagged user must always be able to
 * reach. Only `authLayout`'s session guard (its direct parent) applies —
 * `shellLayout`'s forced-change guard must never sit above this route,
 * otherwise a flagged user would bounce forever and could never clear the
 * flag.
 */
describe('cambiarPasswordRoute', () => {
  it('declares no beforeLoad of its own', () => {
    expect(cambiarPasswordRoute.options.beforeLoad).toBeUndefined();
  });

  it('is parented directly to authLayout, not shellLayout', () => {
    expect(cambiarPasswordRoute.options.getParentRoute?.()).toBe(authLayout);
  });
});
