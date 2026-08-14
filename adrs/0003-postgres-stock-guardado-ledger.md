# ADR 0003: Modelo de datos y persistencia — Postgres con stock guardado y ledger de movimientos

## Estado

Aceptado

## Contexto

El PRD impone dos requisitos que tensionan entre sí:

1. **Todo auditable:** el 100 % de los movimientos debe quedar registrado con fecha, usuario y
   motivo, permitiendo auditar el historial de cualquier producto; el reporte de discrepancias del
   encargado depende de esa traza.
2. **Stock en tiempo real:** el stock mostrado debe coincidir con el registrado tras cada
   movimiento (0 desfasajes lógicos), reflejando el resultado apenas se confirma la operación.

El Design.md refuerza el requisito de auditoría (cada movimiento muestra fecha, usuario y motivo;
tablas de movimientos con cantidades con signo −2/+50) y el de lectura rápida de stock (KPIs,
tablas de stock actual, chips de quiebre/bajo). Hay que decidir cómo se representa el stock y sobre
qué base de datos.

## Decisión

Base de datos **PostgreSQL relacional**. El `stock_actual` se **guarda como campo** en la entidad
Producto (lectura directa y barata para pantallas y reportes), y **toda** modificación de stock
pasa obligatoriamente por un registro en la tabla **`movimientos` (ledger)**. La actualización del
campo y el asiento en el ledger ocurren **en una única transacción atómica**: no existe forma de
cambiar el stock sin dejar su rastro auditable. `movimientos.stock_resultante` se calcula y
persiste **dentro de esa misma transacción**, inmediatamente después del update de stock, para que
refleje el valor real bajo concurrencia y no uno leído antes de que otra transacción lo modificara.

`movimientos` lleva además un `CHECK` que ata el signo de `cantidad` a `tipo`: `entrada` exige
`cantidad > 0`; `salida` y `venta` exigen `cantidad < 0`; `ajuste` admite cualquier signo (una
corrección puede ir en cualquier dirección). Esto cierra en la base de datos una inconsistencia que
de otro modo solo la capa de aplicación evitaría (p. ej. una `entrada` cargada con cantidad
negativa por error de código).

## Alternativas consideradas

- **Postgres con stock derivado del ledger (event-sourcing liviano)** — no se guarda el stock;
  se calcula sumando los movimientos. Da auditoría perfecta por diseño y cero riesgo de desfasaje,
  pero encarece cada lectura de stock (SUM o vistas materializadas a mantener), justo la operación
  más frecuente de las pantallas y KPIs. Se descartó por costo de lectura y complejidad.
- **SQLite con stock guardado + ledger** — mismo diseño lógico sin servidor de BD (archivo único),
  atractivo para un local único. Se descartó porque SQLite serializa las escrituras (un solo
  escritor) y el POS con concurrencia elegida ([[0005-update-atomico-condicional]]) se apoya en el
  control de concurrencia transaccional de Postgres; además Postgres deja mejor preparado el
  crecimiento (más carga, futura multi-sucursal) sin migrar de motor.

## Consecuencias

- Lecturas de stock directas y rápidas para tablas, KPIs y reportes, sin cálculos agregados.
- Auditoría garantizada por construcción: el campo y el ledger se escriben juntos o no se escribe
  nada; el reporte de discrepancias se apoya en el ledger.
- El modelo de la venta se diseña como transacción con ítems, importe y medio de pago, y con campos
  reservados para la futura factura fiscal (etapa 2), sin implementarla en v1.
- **Trade-off:** se mantiene un dato redundante (`stock_actual`) que es un derivado del ledger.
  Si una escritura rompiera la atomicidad (bug), stock y ledger podrían divergir; se mitiga
  obligando a que toda escritura pase por la transacción y agregando una verificación periódica de
  consistencia (stock vs suma del ledger) como control.
- El `CHECK` de signo/tipo en `movimientos` previene por construcción una clase de bug (signo
  invertido según el tipo) sin depender de que la capa de aplicación lo valide siempre bien.
