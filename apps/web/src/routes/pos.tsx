import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../components/ui/Button.js';
import { CarritoPanel } from '../features/pos/CarritoPanel.js';
import { CatalogoGrid } from '../features/pos/CatalogoGrid.js';
import { PagoPanel } from '../features/pos/PagoPanel.js';
import { useCarrito } from '../features/pos/useCarrito.js';
import type { VentaConfirmada } from '../features/pos/useConfirmarVenta.js';
import styles from './pos.module.css';
import { shellLayout } from './shellLayout.js';

/**
 * pos-ui / Role Gate — POS Screen Reachable By Both Roles (spec.md L21-29).
 * Mounted directly under `shellLayout`, NOT `encargadoLayout` — `encargado`
 * and `deposito` both reach `POST /api/ventas` server-side (D-role gate on
 * `routes/ventas.ts`), so this route mirrors that boundary exactly
 * (CLAUDE.md: "Route guards are for encargado-only subtrees").
 *
 * Two-pane grid (design.md D-layout, `docs/design.md:93`): `1.2fr | 460px`.
 * The cart+payment column is fixed on the right so both panes stay visible
 * together while the cashier browses the catalog (spec.md's Fixed Two-Pane
 * Layout requirement).
 */
export const posRoute = createRoute({
  getParentRoute: () => shellLayout,
  path: '/pos',
  component: PosScreen,
});

function PosScreen() {
  const usuario = posRoute.useRouteContext().usuario;
  const carrito = useCarrito(usuario.id);
  // PD-10: the confirmed venta, held here (not in `PagoPanel`) so the
  // success screen can replace the two-pane grid outright. Unmounting
  // `PagoPanel` while this is set also resets its local `pagos`/
  // `montoInput`/`precioOverrides` state for free (D5's latent-defect fix)
  // — a fresh `PagoPanel` instance mounts once "Nueva venta" clears this.
  const [ventaConfirmada, setVentaConfirmada] =
    useState<VentaConfirmada | null>(null);

  if (ventaConfirmada) {
    return (
      <div className={styles.successScreen} aria-label="Venta confirmada">
        <h1>Venta confirmada</h1>
        <p>
          Correlativo <strong>#{ventaConfirmada.numeroCorrelativo}</strong>
        </p>
        <p>
          Total <strong>${ventaConfirmada.total}</strong>
        </p>
        <div className={styles.successActions}>
          <Link
            to="/ventas/$id/recibo"
            params={{ id: ventaConfirmada.id }}
            className={styles.verReciboLink}
          >
            Ver recibo
          </Link>
          <Link to="/ventas/recibo" className={styles.verReciboLink}>
            Buscar recibo
          </Link>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setVentaConfirmada(null)}
          >
            Nueva venta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <CatalogoGrid
        bloqueoStock={carrito.bloqueoStock}
        onAgregar={carrito.agregar}
      />
      <div className={styles.derecha}>
        <CarritoPanel
          items={carrito.items}
          onActualizarCantidad={carrito.actualizarCantidad}
          onQuitar={carrito.quitar}
          onVaciar={carrito.vaciar}
        />
        <PagoPanel
          items={carrito.items}
          vaciarCarrito={carrito.vaciar}
          onVentaConfirmada={setVentaConfirmada}
        />
      </div>
    </div>
  );
}
