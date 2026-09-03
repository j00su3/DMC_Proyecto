import type { AuditoriaRepo } from '../auditoria/repository.js';
import { recordAudit } from '../auditoria/service.js';
import type { Movimiento, MovimientosRepo } from '../movimientos/repository.js';
import type { AlertasRepo, TipoAlertaEvaluada } from './repository.js';

// The narrow slice of a Movimiento the evaluator needs. Deliberately not
// `Movimiento` itself: at the productos/service.ts::crearProducto call site
// the "movimiento" is the row movimientos.create just returned, and at the
// ventas/service.ts call sites it is the per-item row from Pass B's loop —
// both are full Movimiento rows, so this narrower shape is satisfied by
// either without an explicit cast.
export interface EvaluadorMovimiento {
  id: string;
  productoId: string;
  cantidad: number; // signed delta, verbatim (never recomputed)
  stockResultante: number; // aplicarDelta's return value, verbatim
  esDiscrepancia: boolean;
  tipo: Movimiento['tipo']; // design.md D3 — anularVenta exclusion guard
}

export interface EvaluarParams {
  movimiento: EvaluadorMovimiento;
  // design.md's critical correctness note: ONLY stockMinimo, never
  // stockActual — confirmarVenta's Pass-A producto snapshot is stale on
  // stockActual by the time Pass B runs, but stockMinimo does not change
  // within the sale's own transaction.
  stockMinimo: number | null;
  actorId: string;
}

// The narrow repo dependency the evaluator (and its recordAudit calls, D2)
// needs — never the full Repos, so a call site cannot accidentally hand it
// something wider than it should touch.
export interface EvaluadorRepos {
  alertas: AlertasRepo;
  auditoria: AuditoriaRepo;
  movimientos: Pick<MovimientosRepo, 'resumenRotacion'>; // design.md D7
}

async function crearYAuditar(
  repos: EvaluadorRepos,
  productoId: string,
  movimientoId: string,
  tipo: TipoAlertaEvaluada,
  actorId: string,
): Promise<void> {
  const alertaCreada = await repos.alertas.create({
    productoId,
    tipo,
    movimientoId,
  });
  if (!alertaCreada) {
    // D4 dedup: an open alert for this producto+tipo already existed — no
    // row was written, so there is nothing to audit either.
    return;
  }
  await recordAudit(repos.auditoria, {
    entidad: 'alertas',
    entidadId: alertaCreada.id,
    accion: 'crear',
    usuarioId: actorId,
    datosPrevios: null,
    datosPosteriores: { ...alertaCreada },
  });
}

async function autoResolverYAuditar(
  repos: EvaluadorRepos,
  productoId: string,
  tipo: TipoAlertaEvaluada,
  actorId: string,
): Promise<void> {
  const alertaResuelta = await repos.alertas.autoResolve(productoId, tipo);
  if (!alertaResuelta) {
    // No activa/vista alert of this tipo existed for the producto — nothing
    // changed, nothing to audit.
    return;
  }
  // D2: an auto-resolution audits the actor of the TRIGGERING movement,
  // while the alert row's own resuelta_por stays null (A10 rule 3) — the
  // two fields deliberately answer different questions.
  await recordAudit(repos.auditoria, {
    entidad: 'alertas',
    entidadId: alertaResuelta.id,
    accion: 'actualizar',
    usuarioId: actorId,
    datosPrevios: { estado: 'activa' },
    datosPosteriores: { estado: 'resuelta', resueltaPor: null },
  });
}

// design.md's "Evaluator Logic (exact)" section, owner-ratified 2026-09-02 —
// binding, not re-decided here. `stockResultante` is `movimiento.
// stockResultante` verbatim (never recomputed); `stockPrevio` is derived
// from it and the signed `cantidad` delta.
//
// Every branch below is independent (not an if/else-if chain) — a single
// movimiento CAN fire both `discrepancia` and `quiebre` in the same call,
// e.g. a flagged ajuste that also crosses to zero.
export async function evaluar(
  repos: EvaluadorRepos,
  { movimiento, stockMinimo, actorId }: EvaluarParams,
): Promise<void> {
  const stockResultante = movimiento.stockResultante;
  const stockPrevio = movimiento.stockResultante - movimiento.cantidad;
  const quiebreCruzo = stockPrevio > 0 && stockResultante <= 0;

  if (movimiento.esDiscrepancia) {
    await crearYAuditar(
      repos,
      movimiento.productoId,
      movimiento.id,
      'discrepancia',
      actorId,
    );
  }

  if (quiebreCruzo) {
    await crearYAuditar(
      repos,
      movimiento.productoId,
      movimiento.id,
      'quiebre',
      actorId,
    );
  }

  if (stockPrevio <= 0 && stockResultante > 0) {
    await autoResolverYAuditar(
      repos,
      movimiento.productoId,
      'quiebre',
      actorId,
    );
  }

  if (stockMinimo !== null && !quiebreCruzo) {
    // Owner-ratified 2026-09-02: when stockMinimo === 0, the quiebre
    // crossing (stockResultante <= 0) and the stock_bajo crossing
    // (stockResultante <= stockMinimo) are the same event — quiebre alone
    // is correct; the `!quiebreCruzo` guard above suppresses a redundant
    // stock_bajo.
    if (stockPrevio > stockMinimo && stockResultante <= stockMinimo) {
      await crearYAuditar(
        repos,
        movimiento.productoId,
        movimiento.id,
        'stock_bajo',
        actorId,
      );
    }
    if (stockPrevio <= stockMinimo && stockResultante > stockMinimo) {
      await autoResolverYAuditar(
        repos,
        movimiento.productoId,
        'stock_bajo',
        actorId,
      );
    }
  }

  // design.md D3/D5/D6/D7, ADR-0008's S7 heuristic. `anularVenta`'s movements
  // are excluded here — a reversal restores stock, not new outbound demand —
  // so `resumenRotacion` is never even queried for them.
  if (movimiento.tipo !== 'anulacion') {
    const { unidadesSalida30d, diasHistoria } =
      await repos.movimientos.resumenRotacion(movimiento.productoId);
    if (diasHistoria >= 7) {
      const divisor = Math.min(diasHistoria, 30);
      const promedioDiario = unidadesSalida30d / divisor;
      if (promedioDiario > 0) {
        const coberturaDias = movimiento.stockResultante / promedioDiario;
        if (coberturaDias < 14) {
          await crearYAuditar(
            repos,
            movimiento.productoId,
            movimiento.id,
            'sugerencia_reposicion',
            actorId,
          );
        }
      }
    }
  }
}

// design.md task 2.2 names it `EvaluadorDeAlertas.evaluar`; the exact call
// shape in design.md's Interfaces/Contracts section calls the bare `evaluar`
// function directly. Both are exported, same function, so either reference
// works at a call site.
export const EvaluadorDeAlertas = { evaluar };
