# ADR 0006: Resiliencia — Política de stock insuficiente: bloquear siempre (nunca negativo)

## Estado

Aceptado

## Contexto

El PRD deja abiertos varios casos borde relacionados: "Stock negativo" (salida mayor al
disponible: ¿se bloquea, se permite con advertencia, se registra como faltante?), "Venta sin stock
suficiente" (¿se bloquea, se permite en negativo, se avisa al cajero?) y la garantía de que "el
stock mostrado coincide con el registrado". Es una decisión de negocio, no solo técnica, y hay que
fijarla explícitamente porque condiciona el POS, las salidas y los reportes.

## Decisión

**Bloquear siempre: el stock nunca queda por debajo de cero.** Toda venta o salida que supere el
stock disponible se **rechaza** con un mensaje claro al usuario (p. ej. "Stock insuficiente: hay
N"), y el cajero/operario ajusta la cantidad. La corrección de faltantes reales se hace por la vía
auditada: una **entrada** (reposición) o un **ajuste con motivo obligatorio**, que quedan en el
ledger y, en el caso del ajuste, visibles en el reporte de discrepancias del encargado. Esta regla
aplica por igual a ventas del POS y a salidas por consumo/merma.

## Alternativas consideradas

- **Permitir con advertencia (stock negativo)** — dejar vender/sacar aunque el stock quede
  negativo, registrando el faltante y avisando. Es más fiel cuando la realidad física va antes que
  el registro (el producto ya está en mano). Se descartó porque rompe la garantía "stock ≥ 0" y la
  de "el stock mostrado coincide con el registrado", y obliga al encargado a reconciliar negativos;
  contradice además la simplicidad del update condicional elegido.
- **Regla mixta (bloquear venta, permitir salida en negativo con motivo)** — más fiel a la
  operación real (a veces la salida se registra después de que la mercadería ya salió). Se descartó
  para v1 por introducir dos comportamientos distintos según el tipo de movimiento, con más casos
  que explicar y testear; puede reconsiderarse si la operación real lo exige.

## Consecuencias

- Garantía fuerte y simple: el stock nunca es negativo, coherente con
  [[0005-update-atomico-condicional]] (la condición `stock >= :n` lo impone en la BD) y con el
  criterio de éxito "0 desfasajes lógicos".
- Comportamiento único y predecible para todo el equipo; menos casos borde que testear.
- **Trade-off:** cuando la realidad física ya cambió pero el registro no (mercadería que salió sin
  cargarse), el sistema obliga a un paso extra —un ajuste/entrada con motivo— en lugar de aceptar
  el negativo. Se acepta a cambio de mantener la integridad del inventario y una traza auditable de
  cada corrección.
- **Trade-off:** en un pico de caja, una venta rechazada por stock desactualizado puede frenar al
  cajero; se mitiga con el mensaje claro y con la carga ágil de ajustes/entradas.
