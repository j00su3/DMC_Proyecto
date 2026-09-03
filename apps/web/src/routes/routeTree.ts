import { rootRoute } from './__root.js';
import { alertasRoute } from './alertas.js';
import { authLayout } from './authLayout.js';
import { cambiarPasswordRoute } from './cambiarPassword.js';
import { encargadoLayout } from './encargadoLayout.js';
import { indexRoute } from './index.js';
import { ingresarRoute } from './ingresar.js';
import { posRoute } from './pos.js';
import { productosListRoute } from './productos.js';
import { productosDetalleRoute } from './productosDetalle.js';
import { productosNuevoRoute } from './productosNuevo.js';
import { proveedoresRoute } from './proveedores.js';
import { publicLayout } from './publicLayout.js';
import { reciboRoute } from './recibo.js';
import { reciboBuscarRoute } from './reciboBuscar.js';
import { shellLayout } from './shellLayout.js';
import { usuariosListRoute } from './usuarios.js';
import { usuariosDetalleRoute } from './usuariosDetalle.js';
import { usuariosNuevoRoute } from './usuariosNuevo.js';

/**
 * Code-based route tree (D10) — no `@tanstack/router-plugin`, no generated
 * `routeTree.gen.ts`. Nesting mirrors the server allowlist (D11):
 * `shellLayout` (forced-change guard) sits under `authLayout` (session
 * guard); `cambiarPasswordRoute` is a child of `authLayout` directly, so it
 * stays reachable while the flag is `true`. `encargadoLayout` (role guard,
 * UX convenience only — see its own docblock) sits under `shellLayout`, so
 * the client evaluates session -> forced-change -> role, matching the
 * server's 401 -> 403 PASSWORD_CHANGE_REQUIRED -> 403 FORBIDDEN order.
 */
export const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([ingresarRoute]),
  authLayout.addChildren([
    cambiarPasswordRoute,
    shellLayout.addChildren([
      indexRoute,
      posRoute,
      reciboRoute,
      reciboBuscarRoute,
      productosListRoute,
      productosNuevoRoute,
      productosDetalleRoute,
      proveedoresRoute,
      alertasRoute,
      encargadoLayout.addChildren([
        usuariosListRoute,
        usuariosNuevoRoute,
        usuariosDetalleRoute,
      ]),
    ]),
  ]),
]);
