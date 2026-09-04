import type { AlertasRepo } from '../alertas/repository.js';
import type { MovimientosRepo } from '../movimientos/repository.js';
import type { ProductosRepo } from '../productos/repository.js';

// backlog #13 (dashboard-kpis) design.md D2: narrow read-only dependency,
// mirroring reportes/service.ts's own ReadRepos precedent.
export interface ReadRepos {
  alertas: Pick<AlertasRepo, 'countAbiertasPorTipo' | 'countAbiertas'>;
  movimientos: Pick<MovimientosRepo, 'listRecientes'>;
  productos: Pick<ProductosRepo, 'findById'>;
}

// design.md D3's exact dashboardResumenDto shape — the actividad reciente
// row is deliberately narrower than the full Movimiento (no cantidad,
// motivo, etc.), matching the response schema.
export interface ActividadRecienteItem {
  id: string;
  productoId: string;
  productoNombre: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';
  fecha: Date;
  usuarioId: string;
}

export interface DashboardResumen {
  quiebres: number;
  stockBajo: number;
  alertasActivas: number;
  actividadReciente: ActividadRecienteItem[];
}

// design.md D4 — route-level constant, never a client query param.
export const ACTIVIDAD_RECIENTE_LIMIT = 10;

// design.md D2: 4 calls via Promise.all (3 counts + 1 list), not a single
// combined SQL query — matches this project's "multiple functions, no
// combined query" precedent for multi-metric screens (reportes/service.ts).
// productoNombre resolution follows the exact same N+1 idiom as
// reportes/service.ts::listarMovimientosPeriodo (D1, D6's activo=false case
// — no special-casing needed).
export async function obtenerResumen(
  repos: ReadRepos,
): Promise<DashboardResumen> {
  const [quiebres, stockBajo, alertasActivas, movimientosRecientes] =
    await Promise.all([
      repos.alertas.countAbiertasPorTipo('quiebre'),
      repos.alertas.countAbiertasPorTipo('stock_bajo'),
      repos.alertas.countAbiertas(),
      repos.movimientos.listRecientes(ACTIVIDAD_RECIENTE_LIMIT),
    ]);

  const actividadReciente: ActividadRecienteItem[] = [];
  for (const movimiento of movimientosRecientes) {
    const producto = await repos.productos.findById(movimiento.productoId);
    actividadReciente.push({
      id: movimiento.id,
      productoId: movimiento.productoId,
      productoNombre: producto?.nombre ?? '',
      tipo: movimiento.tipo,
      fecha: movimiento.fecha,
      usuarioId: movimiento.usuarioId,
    });
  }

  return { quiebres, stockBajo, alertasActivas, actividadReciente };
}
