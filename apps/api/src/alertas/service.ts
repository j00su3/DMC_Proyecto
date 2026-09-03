import { recordAudit } from '../auditoria/service.js';
import type { UnitOfWork } from '../db/uow.js';
import type { TxControl } from '../db/uow.js';
import {
  alertAlreadyResolved,
  alertNotFound,
  alertNotManuallyResolvable,
} from '../lib/errors.js';
import type { ProductosRepo } from '../productos/repository.js';
import {
  type EvaluadorMovimiento,
  type EvaluadorRepos,
  evaluar,
} from './evaluador.js';
import type {
  Alerta,
  AlertasRepo,
  FiltroAlertas,
  TipoAlertaEvaluada,
} from './repository.js';

export interface RegistrarSiCorrespondeParams {
  movimiento: EvaluadorMovimiento;
  stockMinimo: number | null;
  actorId: string;
}

// design.md's D1/D2 SAVEPOINT mechanism and the exact call shape in its
// Interfaces/Contracts section. Every one of the four call sites
// (movimientos/service.ts, productos/service.ts::crearProducto,
// ventas/service.ts::confirmarVenta + anularVenta) invokes the evaluator
// through exactly this helper, never `evaluar` directly, so an evaluator
// failure — SQL or app-level — rolls back only the alert side effect and
// the outer movimiento/venta transaction still commits (C1, ADR-0008).
export async function registrarSiCorresponde(
  repos: EvaluadorRepos,
  tx: TxControl,
  params: RegistrarSiCorrespondeParams,
): Promise<void> {
  await tx.savepoint('alertas', () => evaluar(repos, params));
}

// Narrow read-only dependency for the two list/count queries below —
// mirrors proveedores/service.ts's ReadRepos. `productos` is needed only to
// resolve `productoNombre` per design.md D6 (an N+1 per-row lookup, not a
// repository join — same idiom as ventas/service.ts::getRecibo).
export interface ReadRepos {
  alertas: AlertasRepo;
  productos: Pick<ProductosRepo, 'findById'>;
}

export interface AlertaConProducto extends Alerta {
  productoNombre: string;
}

export interface ListarAlertasInput {
  filtro: FiltroAlertas;
  page: number;
  pageSize: number;
}

export async function listar(
  repos: ReadRepos,
  input: ListarAlertasInput,
): Promise<{ rows: AlertaConProducto[]; total: number }> {
  const { rows, total } = await repos.alertas.list(
    input.filtro,
    input.page,
    input.pageSize,
  );

  const rowsConProducto: AlertaConProducto[] = [];
  for (const alerta of rows) {
    const producto = await repos.productos.findById(alerta.productoId);
    rowsConProducto.push({ ...alerta, productoNombre: producto?.nombre ?? '' });
  }

  return { rows: rowsConProducto, total };
}

export async function contarAbiertas(
  repos: Pick<ReadRepos, 'alertas'>,
): Promise<number> {
  return repos.alertas.countAbiertas();
}

// Owner-ratified 2026-09-02, design.md's Routes table (PD-3): only
// `discrepancia` is manually resolvable — `stock_bajo`/`quiebre` only ever
// auto-resolve on stock recovery.
const TIPOS_MANUALMENTE_RESOLVIBLES: readonly TipoAlertaEvaluada[] = [
  'discrepancia',
];

export interface ResolverAlertaInput {
  id: string;
  actorId: string;
}

// spec.md "Manual Resolution Restricted To Encargado" — role check happens
// at the route (config.roles), classify-on-undefined happens here
// (rechazarVenta precedent): 404 for no row at all, 409 for a row that
// exists but is already resuelta or not manually resolvable.
export async function resolver(
  uow: UnitOfWork,
  input: ResolverAlertaInput,
): Promise<Alerta> {
  return uow.run(async (repos) => {
    const alerta = await repos.alertas.findById(input.id);
    if (!alerta) {
      throw alertNotFound();
    }
    if (alerta.estado === 'resuelta') {
      throw alertAlreadyResolved();
    }
    if (
      !TIPOS_MANUALMENTE_RESOLVIBLES.includes(alerta.tipo as TipoAlertaEvaluada)
    ) {
      throw alertNotManuallyResolvable();
    }

    const resuelta = await repos.alertas.manualResolve(input.id, input.actorId);
    if (!resuelta) {
      // Race: the alert became resuelta between findById and manualResolve.
      throw alertAlreadyResolved();
    }

    await recordAudit(repos.auditoria, {
      entidad: 'alertas',
      entidadId: resuelta.id,
      accion: 'actualizar',
      usuarioId: input.actorId,
      datosPrevios: { estado: alerta.estado },
      datosPosteriores: { estado: 'resuelta', resueltaPor: input.actorId },
    });

    return resuelta;
  });
}

// auditoria/fields.ts's `alertas` entry docblock: deliberately NOT audited —
// a bulk UPDATE with no single actor-attributable row. Reads via
// `ReadRepos` directly (no `UnitOfWork`/savepoint needed): it is one atomic
// UPDATE statement, not a multi-step write that needs a transaction boundary.
export async function marcarVistas(
  repos: Pick<ReadRepos, 'alertas'>,
): Promise<number> {
  return repos.alertas.marcarVistas();
}
