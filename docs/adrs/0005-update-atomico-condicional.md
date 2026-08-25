# ADR 0005: Manejo de estado y concurrencia — Update atómico condicional sobre el stock

## Estado

Aceptado — actualizado 2026-08-13: los movimientos de reversión por anulación (`anulacion`)
quedan exentos de la condición `activo = true` (resuelve A8 de la Ronda 2 de
`REVISION-ADVERSARIAL.md`; ver `TECH-DESIGNv2.md`).

## Contexto

El PRD lista explícitamente el caso borde "Registros concurrentes": dos usuarios modificando el
stock del mismo producto casi al mismo tiempo. El POS descuenta stock al confirmar la venta y el
personal de depósito registra entradas/salidas en paralelo. Con el stock guardado como campo (ver
[[0003-postgres-stock-guardado-ledger]]), dos operaciones simultáneas mal coordinadas podrían
pisar el valor y corromper el stock. Además, la política de negocio elegida
([[0006-bloquear-stock-insuficiente]]) exige que el stock nunca quede negativo.

Hay que decidir el mecanismo de control de concurrencia sobre el stock de un producto.

## Decisión

Se usa un **UPDATE atómico condicional**: el descuento de stock y su validación ocurren en una
única sentencia SQL de la forma `UPDATE productos SET stock = stock - :n WHERE id = :id AND
stock >= :n AND activo = true`. La condición `activo = true` bloquea movimientos nuevos (ventas,
entradas, salidas, ajustes) sobre un producto dado de baja lógicamente: un producto inactivo solo
admite lectura de su historial, no escritura; reactivarlo (`activo=true`) queda reservado al
encargado, igual que la baja. Si la sentencia afecta 0 filas, significa **stock insuficiente o
producto inactivo/inexistente** y la operación se rechaza; el número de unidades disponibles que se muestra en el mensaje de error ("stock
insuficiente: hay N") se lee dentro de la misma transacción, no de una consulta previa, para que
no quede desactualizado. Para ventas **multi-ítem**, cada ítem aplica su propio update condicional
**dentro de una única transacción**, **procesados en un orden determinístico (por `producto_id`)**
para evitar deadlocks entre transacciones concurrentes que toquen los mismos productos en distinto
orden; si alguno falla, se hace rollback de toda la venta (ningún ítem se descuenta a medias). Cada
update exitoso va acompañado, en la misma transacción, del asiento en el ledger.

**Excepción — reversión por anulación de venta:** los movimientos tipo `anulacion` (los que
revierten el stock al anular una venta, positivos y ligados a la `venta_id` original) **no**
incluyen la condición `activo = true` en su UPDATE — y como suman stock, tampoco necesitan
`stock >= :n`. La razón: la reversión de una operación pasada no es un "movimiento nuevo" de
negocio. Sin esta exención, anular una venta cuyo producto fue dado de baja después de venderse
sería imposible (el UPDATE afectaría 0 filas y la anulación entera haría rollback), forzando al
encargado a reactivar el producto, anular y volver a darlo de baja — tres operaciones sin traza
que explique por qué. Un producto inactivo puede así quedar con stock > 0 tras una anulación; ese
stock no vuelve a moverse salvo que el encargado lo reactive.

## Alternativas consideradas

- **Bloqueo pesimista (`SELECT ... FOR UPDATE`)** — tomar un lock de fila del producto antes de
  leer y escribir; simple de razonar y correcto. Se descartó como mecanismo principal porque el
  update condicional logra la misma garantía de correctitud con una sola sentencia y sin mantener
  el lock durante la lógica intermedia; el pesimista queda disponible si algún flujo futuro
  necesita leer-decidir-escribir con pasos intermedios.
- **Bloqueo optimista (columna de versión + reintento)** — escala mejor con alta concurrencia,
  pero agrega lógica de detección de conflicto y reintento que un local único, con concurrencia
  baja, rara vez ejercitaría. Se descartó por complejidad no justificada.

## Consecuencias

- Correctitud garantizada bajo concurrencia con el mínimo de mecanismos: la condición
  `stock >= :n` hace imposible el negativo por venta/salida, cumpliendo
  [[0006-bloquear-stock-insuficiente]] a nivel de base de datos.
- Un producto dado de baja queda protegido contra movimientos nuevos a nivel de base de datos
  (`activo = true` en la misma condición), no solo por una validación en la capa de aplicación que
  se pudiera olvidar en un endpoint nuevo — con la única excepción declarada de la reversión por
  anulación (`anulacion`), que puede ejecutarse sobre un producto inactivo.
- **Trade-off:** la exención de `anulacion` implica que un producto inactivo puede terminar con
  stock > 0 (visible en inventario como inactivo con existencias); se acepta porque la
  alternativa — no poder anular, o reactivar/anular/desactivar sin traza — es peor para la
  auditabilidad que el propio caso que se protege.
- Muy buen rendimiento: una sola sentencia por ítem, sin locks explícitos sostenidos.
- **Trade-off:** parte de la regla de negocio (no vender por debajo de cero) queda **embebida en
  el SQL**, no solo en la capa de dominio; hay que mantener esa condición sincronizada con las
  reglas de negocio y cubrirla con tests.
- **Trade-off:** una venta multi-ítem se traduce en varias sentencias dentro de la transacción
  (una por ítem) y en manejo explícito del rollback parcial; es más código que un único descuento,
  a cambio de atomicidad correcta. Esto cubre también el caso borde "Venta interrumpida": mientras
  la transacción no se confirma, no se descuenta stock.
- **Trade-off:** dos ventas concurrentes que comparten productos pueden seguir chocando entre sí
  (una espera el lock de la otra); el orden determinístico evita el **deadlock** (que Postgres
  reportaría como error `40P01`), pero no elimina la espera — con la concurrencia baja de un local
  único, se considera aceptable sin mecanismo adicional. Debe cubrirse con tests de concurrencia
  (ver riesgos abiertos del TDD).
