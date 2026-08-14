# ADR 0008: Motor de alertas — Servicio de reglas detrás de una interfaz

## Estado

Aceptado — actualizado 2026-08-13: se fijan el aislamiento por `SAVEPOINT` (C1), la definición
operativa de la heurística de reposición (S7) y el ciclo de vida/anti-ruido de las alertas (A10),
de la Ronda 2 de `REVISION-ADVERSARIAL.md`; ver `TECH-DESIGNv2.md`.

## Contexto

El PRD pide alertas inteligentes por stock bajo/quiebre, por diferencias de inventario y
(best-effort) sugerencias de reposición. En v1 se implementan con **reglas y umbrales**, pero el
PRD es enfático en que el motor está pensado para **evolucionar hacia modelos de ML** (predicción
de demanda/reposición) y que "el diseño debe dejar la puerta abierta" sin rehacerlo. El criterio de
éxito exige que la alerta de stock bajo se dispare dentro de **1 minuto** de cruzado el umbral; con
la arquitectura elegida ([[0001-monolito-api-spa]]) las alertas se evalúan en la transacción del
movimiento, lo que lo garantiza. También hay que contemplar el caso borde "alertas repetidas/ruido"
(no saturar al usuario).

## Decisión

La evaluación de alertas se encapsula en un módulo **`EvaluadorDeAlertas` detrás de una interfaz
explícita** (p. ej. `evaluar(movimiento, producto) -> Alerta[]`), invocado al confirmar cada
movimiento. En v1 la implementación es **`ReglasUmbral`** (stock ≤ mínimo, quiebre = stock 0,
discrepancia detectada en ajustes, y **sugerencia de reposición** — ver abajo). En etapa 2, un
**`EvaluadorML`** puede implementar la misma interfaz sin tocar los flujos que la invocan.

**Ciclo de vida y anti-ruido:** la lógica vive dentro del evaluador/estado de alertas, con estas
reglas concretas:

- **Creación por cruce:** `stock_bajo` se crea solo cuando el movimiento hace cruzar el umbral
  hacia abajo (`stock_previo > stock_minimo` y `stock_resultante ≤ stock_minimo`); `quiebre`,
  cuando cruza a 0. Un movimiento que deja el stock bajo el umbral pero que ya estaba abajo no
  crea nada — el ruido de oscilación se elimina en origen.
- **De-duplicación:** no se crea una alerta si ya existe una del mismo `producto_id` + `tipo` en
  estado `activa` o `vista` (`vista` = leída, no resuelta: sigue bloqueando duplicados). Solo
  `resuelta` cierra el ciclo y habilita un disparo futuro.
- **Resolución automática:** `stock_bajo` se resuelve sola cuando un movimiento deja
  `stock_actual > stock_minimo`; `quiebre`, cuando deja `stock_actual > 0` — sea cual sea la
  causa (entrada, ajuste o anulación de venta). La resuelve el propio evaluador, en la misma
  transacción, con `resuelta_por` nulo.
- **Resolución manual:** `discrepancia` y `sugerencia_reposicion` no tienen condición automática
  de salida; las resuelve el encargado desde la UI.

**Regla de `sugerencia_reposicion` en v1:** el PRD incluye las sugerencias de reposición
"best-effort según consumo histórico" dentro del alcance de v1 (no son exclusivas de etapa 2, a
diferencia del resto del ML). `ReglasUmbral` las cubre con una heurística simple, no un modelo
predictivo, con esta definición operativa única (para que dos implementadores produzcan la misma
regla):

- `promedio_diario` = unidades salidas del producto (tipos `venta` y `salida`) en los últimos
  30 días ÷ 30 — un promedio **diario en unidades/día**, no el total del período.
- `cobertura_dias` = `stock_actual` ÷ `promedio_diario`.
- Se genera `sugerencia_reposicion` cuando `cobertura_dias < N`, con **N = 14 días** (constante
  fija en v1, configurable a futuro, no aprendida).
- **Historia insuficiente:** el producto necesita ≥ 7 días desde su primer movimiento; entre 7 y
  30 días, el promedio se calcula sobre los días disponibles; con menos de 7 días no se evalúa
  (evita sugerencias basadas en un pico de un día).
- **Sin salidas en el período** (`promedio_diario = 0`): no se sugiere nunca — los productos sin
  rotación quedan cubiertos por `stock_bajo`/`quiebre`, no por esta regla.

Esta regla, igual que las demás, queda detrás de la misma interfaz y puede ser reemplazada por
`EvaluadorML` sin tocar el resto del sistema.

**Política de error del evaluador — mecanismo `SAVEPOINT`:** una excepción o fallo dentro de
`EvaluadorDeAlertas` **no** revierte el movimiento ni la venta que lo invocó. Un try/catch de
aplicación **no alcanza** para garantizarlo: el evaluador ejecuta SQL (lee historial, inserta
alertas), y en Postgres un error SQL deja la transacción entera en estado abortado (`25P02`) — el
COMMIT posterior haría rollback del movimiento y la venta, exactamente el caso inaceptable. Por
eso el mecanismo es explícito: antes de invocar el evaluador se emite `SAVEPOINT alertas`; ante
cualquier fallo — SQL o de aplicación — se ejecuta `ROLLBACK TO SAVEPOINT alertas`, se registra
el error (log) y la transacción del movimiento continúa y confirma igual. En el peor caso se
pierde la generación de una alerta, nunca el movimiento en sí. La evaluación de alertas es valor
agregado, no puede ser el punto de falla de una operación esencial (registrar stock, cobrar una
venta). La alternativa (evaluar inmediatamente después del commit) se descartó: el `SAVEPOINT`
cuesta una línea y conserva la atomicidad alerta+movimiento cuando el evaluador funciona bien.

## Alternativas consideradas

- **Reglas inline sin abstracción** — escribir las condiciones directamente en el flujo de cada
  movimiento (un `if` por regla). Más rápido hoy, pero esparce la lógica de alertas por varios
  endpoints y obliga a refactorizar todos esos puntos cuando llegue el ML. Se descartó por
  contradecir el "dejar la puerta abierta" del PRD.
- **Reglas configurables en datos (mini motor de reglas)** — guardar umbrales/condiciones como
  configuración en la BD e interpretarlas con un evaluador genérico. Más flexible para el encargado
  sin tocar código, pero es sobre-ingeniería para el puñado de reglas fijas de v1. Se descartó por
  complejidad no justificada; la interfaz elegida no impide adoptarlo más adelante.

## Consecuencias

- Punto único de evaluación de alertas, simple de testear, e invocado en la misma transacción del
  movimiento: cumple el objetivo de "< 1 minuto" por construcción.
- La puerta al ML queda abierta con costo mínimo: reemplazar la implementación detrás de la
  interfaz no toca el resto del sistema.
- El control de ruido (alertas repetidas) tiene un lugar natural donde vivir.
- La sugerencia de reposición queda cubierta en v1 con una heurística barata (promedio móvil de
  30 días), sin necesidad de infraestructura de ML para cumplir el "best-effort" que pide el PRD.
- **Trade-off:** la interfaz agrega una indirección respecto de escribir los `if` inline; es una
  pequeña inversión de diseño hoy a cambio de la extensibilidad que el PRD pide explícitamente.
- **Trade-off:** al ejecutarse dentro de la transacción del movimiento, un `EvaluadorML` costoso o
  lento no encaja en este punto sin extraerlo a un proceso asíncrono; la interfaz lo permite, pero
  esa extracción (worker) sería trabajo de etapa 2 (ver [[0001-monolito-api-spa]]).
- **Trade-off:** aislar los errores del evaluador con `SAVEPOINT` (para no bloquear el
  movimiento) implica que un `ReglasUmbral` con bugs puede fallar en silencio: una alerta que
  debía dispararse no se genera y solo queda evidencia en el log, no en la UI. Se acepta porque el
  costo de la alternativa (una venta que no se puede cobrar por un bug del evaluador) es peor. El
  criterio de aceptación correspondiente exige un test que inyecte un error SQL en el evaluador y
  verifique que la venta confirma igual.
- **Trade-off:** la regla de reposición por promedio de 30 días necesita leer movimientos
  históricos del producto en cada evaluación (no solo el movimiento actual como las otras reglas),
  agregando una consulta extra dentro de la transacción; con el volumen de un local único no
  debería pesar, pero es distinto en costo al resto de `ReglasUmbral`.
