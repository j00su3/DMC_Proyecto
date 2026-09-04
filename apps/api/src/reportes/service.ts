import type { AlertasRepo } from '../alertas/repository.js';
import {
  type AlertaConProducto,
  listar as listarAlertas,
} from '../alertas/service.js';
import type { Movimiento, MovimientosRepo } from '../movimientos/repository.js';
import type { Producto, ProductosRepo } from '../productos/repository.js';

// backlog #12 (reportes) design.md D3: narrow read-only dependency for the
// four report orchestrations below — mirrors alertas/service.ts's own
// ReadRepos. `alertas` is the full port (not a Pick) because
// listDiscrepancias delegates straight into alertas/service.ts::listar,
// which itself needs the full AlertasRepo shape.
export interface ReadRepos {
  movimientos: Pick<MovimientosRepo, 'listByPeriodo'>;
  productos: Pick<ProductosRepo, 'findById' | 'list' | 'bajoMinimo'>;
  alertas: AlertasRepo;
}

export interface MovimientoConProducto extends Movimiento {
  productoNombre: string;
}

export interface ListarMovimientosPeriodoInput {
  fechaDesde: Date;
  fechaHasta: Date; // calendar-day inclusive
  page: number;
  pageSize: number;
  actor: { id: string; rol: 'encargado' | 'deposito' };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// design.md D3 — the only place row-level actor scoping happens for the
// movimientos report (ADR-0007/finding A6): `deposito` always has
// `usuarioId` forced to `actor.id`, derived from `requireActor(request.user)`
// at the route, never from any client-supplied field — the Zod querystring
// schema (D5) structurally has no such field. `productoNombre` resolution
// follows the D6 N+1 per-row lookup idiom (alertas/service.ts::listar), not
// a repository join — keeps MovimientosRepo's port "deliberately narrow".
export async function listarMovimientosPeriodo(
  repos: ReadRepos,
  input: ListarMovimientosPeriodoInput,
): Promise<{ rows: MovimientoConProducto[]; total: number }> {
  const usuarioId = input.actor.rol === 'deposito' ? input.actor.id : undefined;
  const fechaHastaExclusiva = addDays(input.fechaHasta, 1);

  const { rows, total } = await repos.movimientos.listByPeriodo(
    { fechaDesde: input.fechaDesde, fechaHastaExclusiva, usuarioId },
    input.page,
    input.pageSize,
  );

  const rowsConProducto: MovimientoConProducto[] = [];
  for (const movimiento of rows) {
    const producto = await repos.productos.findById(movimiento.productoId);
    rowsConProducto.push({
      ...movimiento,
      productoNombre: producto?.nombre ?? '',
    });
  }

  return { rows: rowsConProducto, total };
}

export interface ListStockActualInput {
  page: number;
  pageSize: number;
}

// design.md D5 — reuses ProductosRepo.list() unmodified, no new query.
export async function listStockActual(
  repos: ReadRepos,
  input: ListStockActualInput,
): Promise<{ rows: Producto[]; total: number }> {
  return repos.productos.list(input.page, input.pageSize);
}

export interface ListBajoMinimoInput {
  page: number;
  pageSize: number;
}

// design.md D1 — passthrough over Phase 1's ProductosRepo.bajoMinimo.
export async function listBajoMinimo(
  repos: ReadRepos,
  input: ListBajoMinimoInput,
): Promise<{ rows: Producto[]; total: number }> {
  return repos.productos.bajoMinimo(input.page, input.pageSize);
}

export interface ListDiscrepanciasInput {
  page: number;
  pageSize: number;
}

// design.md D4 — calls the EXISTING alertas/service.ts::listar directly,
// filtered on tipo = 'discrepancia'. Zero new alertas service code; reuses
// its existing D6 productoNombre idiom already built in #10/#11.
export async function listDiscrepancias(
  repos: ReadRepos,
  input: ListDiscrepanciasInput,
): Promise<{ rows: AlertaConProducto[]; total: number }> {
  return listarAlertas(
    { alertas: repos.alertas, productos: repos.productos },
    {
      filtro: { tipo: 'discrepancia' },
      page: input.page,
      pageSize: input.pageSize,
    },
  );
}
