import type { paths } from '../../api/schema.js';
import { Button } from '../../components/ui/Button.js';
import styles from './Recibo.module.css';
import { formatFechaHora } from './format.js';

export type ReciboData =
  paths['/api/ventas/{id}']['get']['responses']['200']['content']['application/json'];

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  qr: 'QR',
};

interface ReciboProps {
  recibo: ReciboData;
}

/**
 * Presentational receipt (recibo-ui spec, "Printable Receipt Route" field
 * list; PD-6 estado as plain text; PD-2 no store identity; PD-12 every
 * `pagos` row + `vuelto` on the cash row when nonzero). Print behaviour is
 * pure `@media print` CSS (D6) — "Imprimir" calls `window.print()` directly,
 * no auto-print on mount (PD-9).
 */
export function Recibo({ recibo }: ReciboProps) {
  const { venta, cajero, items, pagos } = recibo;

  return (
    <div className={styles.recibo}>
      <div className={styles.controls}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.history.back()}
        >
          Volver
        </Button>
        <Button type="button" variant="primary" onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>

      <dl className={styles.meta}>
        <div>
          <dt>Número correlativo</dt>
          <dd>{venta.numeroCorrelativo}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatFechaHora(venta.creadoEn)}</dd>
        </div>
        <div>
          <dt>Cajero</dt>
          <dd>{cajero.nombre}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>{venta.estado}</dd>
        </div>
      </dl>

      <table className={styles.items}>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cantidad</th>
            <th>Precio unitario</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={styles.itemRow}>
              <td>{item.nombre}</td>
              <td>{item.cantidad}</td>
              <td>{`$${item.precioUnitario}`}</td>
              <td>{`$${item.subtotal}`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.importeRow}>
        <span>Importe</span>
        <span className={styles.importeMonto}>{`$${venta.total}`}</span>
      </div>

      <ul className={styles.pagos}>
        {pagos.map((pago) => (
          <li key={pago.id} className={styles.pagoLinea}>
            <span>{MEDIO_LABEL[pago.medio] ?? pago.medio}</span>
            <span>{`$${pago.monto}`}</span>
            {pago.medio === 'efectivo' && Number(pago.vuelto) !== 0 && (
              <span className={styles.vuelto}>{`Vuelto $${pago.vuelto}`}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
