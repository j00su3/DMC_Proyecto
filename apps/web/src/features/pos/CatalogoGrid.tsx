import { useState } from 'react';
import { Button } from '../../components/ui/Button.js';
import { Pagination } from '../../components/ui/Pagination.js';
import styles from './CatalogoGrid.module.css';
import type { ProductoParaCarrito } from './carrito.js';
import { PAGE_SIZE } from './queries.js';
import { useCatalogo } from './useCatalogo.js';

export interface CatalogoGridProps {
  /**
   * The `productoId` whose most recent `AGREGAR` dispatch was refused by
   * the cart reducer for exceeding `stockActual` — `carrito.ts`'s
   * `bloqueoStock` (design.md D-13/PD-13). Rendered as a "sin stock
   * disponible" notice on that product's card instead of the add control.
   */
  bloqueoStock: string | null;
  onAgregar: (producto: ProductoParaCarrito) => void;
}

/**
 * Catalog pane (design.md's `1.2fr` grid column, `docs/design.md:93`).
 * Order (PD-12, alphabetical) and inactive exclusion (PD-8) are both
 * server-side (`GET /api/ventas/catalogo`'s `soloActivos`) — this
 * component pages only and never filters or re-sorts client-side
 * (`queries.ts`'s docblock).
 *
 * PD-8: an active product with zero stock still renders — the cashier can
 * see it exists — but its add control is disabled rather than absent.
 * PD-13: a live block from the cart reducer (`bloqueoStock`, distinct from
 * the static zero-stock case above) replaces the add control with an
 * explicit "sin stock disponible" notice on that one card.
 */
export function CatalogoGrid({ bloqueoStock, onAgregar }: CatalogoGridProps) {
  const [page, setPage] = useState(1);
  const { data, isPlaceholderData } = useCatalogo(page);

  const productos = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className={styles.panel} aria-label="Catálogo de productos">
      <div className={styles.grid} aria-busy={isPlaceholderData || undefined}>
        {productos.map((producto) => {
          const sinStock = producto.stockActual === 0;
          const bloqueado = bloqueoStock === producto.id;

          return (
            <article key={producto.id} className={styles.card}>
              <p className={styles.nombre}>{producto.nombre}</p>
              <p className={styles.sku}>{producto.sku}</p>
              <p className={styles.precio}>${producto.precio}</p>
              <p className={styles.stock}>Stock: {producto.stockActual}</p>

              {bloqueado ? (
                <p className={styles.bloqueo} role="alert">
                  Sin stock disponible
                </p>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  disabled={sinStock}
                  onClick={() =>
                    onAgregar({
                      productoId: producto.id,
                      nombre: producto.nombre,
                      sku: producto.sku,
                      precio: producto.precio,
                      stockActual: producto.stockActual,
                    })
                  }
                >
                  {sinStock ? 'Sin stock' : 'Agregar'}
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        isBusy={isPlaceholderData}
      />
    </section>
  );
}
