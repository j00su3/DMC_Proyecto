import { rootRoute } from './__root.js';
import { authLayout } from './authLayout.js';
import { cambiarPasswordRoute } from './cambiarPassword.js';
import { indexRoute } from './index.js';
import { ingresarRoute } from './ingresar.js';
import { publicLayout } from './publicLayout.js';
import { shellLayout } from './shellLayout.js';

/**
 * Code-based route tree (D10) — no `@tanstack/router-plugin`, no generated
 * `routeTree.gen.ts`. Nesting mirrors the server allowlist (D11):
 * `shellLayout` (forced-change guard) sits under `authLayout` (session
 * guard); `cambiarPasswordRoute` is a child of `authLayout` directly, so it
 * stays reachable while the flag is `true`.
 */
export const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([ingresarRoute]),
  authLayout.addChildren([
    cambiarPasswordRoute,
    shellLayout.addChildren([indexRoute]),
  ]),
]);
