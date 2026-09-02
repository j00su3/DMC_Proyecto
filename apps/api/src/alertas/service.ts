import type { TxControl } from '../db/uow.js';
import {
  type EvaluadorMovimiento,
  type EvaluadorRepos,
  evaluar,
} from './evaluador.js';

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

// Phase 3 (routes/service orchestration — listar/contarAbiertas/resolver/
// marcarVistas) is added in a later apply batch; this file is intentionally
// narrow for PR2's scope.
