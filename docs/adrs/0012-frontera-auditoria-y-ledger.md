# ADR 0012: Frontera entre el ledger de movimientos y la auditoría de registros

## Estado

Aceptado

## Contexto

El proyecto va a tener **dos** mecanismos que guardan historial, y comparten vocabulario. Sin una
frontera escrita, terminan fusionados o duplicados.

**El primero ya está decidido.** El ledger de `movimientos` (ADR-0003) registra cada entrada,
salida, venta, ajuste y anulación, y lleva `usuario_id`, `fecha`, `motivo` y `stock_resultante`
dentro de la misma transacción que actualiza el stock. El TECH-DESIGN lo describe como *"la traza
de auditoría de todo cambio de stock"*. El acotamiento **"de stock"** es correcto y es justamente
lo que se pierde al citarlo de memoria.

**El vocabulario ya está tomado.** Todos los requisitos de auditoría del PRD hablan de
movimientos: *"El 100 % de los movimientos queda registrado con fecha, usuario y motivo, permitiendo
auditar el historial de cualquier producto"*. El PRD **no** pide rastro de cambios sobre registros.
Es decir: cuando el PRD dice "auditoría", habla del ledger.

**El segundo nace de otro problema.** El backlog #2.2 introduce una auditoría general por una
razón que el PRD no cubre: el alta de usuarios con **contraseña temporal** (#3) crea una ventana en
la que el encargado conoce la credencial del empleado. Durante esa ventana, un registro hecho "por
el empleado" no prueba autoría. Eso es no-repudio sobre cambios de registros, no contabilidad de
existencias.

Dos tablas, dos problemas distintos, una sola palabra para nombrarlos. De ahí este ADR.

## Decisión

`movimientos` y `auditoria` son **tablas separadas**, con responsabilidades disjuntas:

| | `auditoria` (#2.2) | `movimientos` (#5/#6) |
|---|---|---|
| Pregunta que responde | ¿Quién tocó este registro? | ¿Por qué el stock dice N? |
| Naturaleza | Metadato — rastro de cambios | Dato del negocio — contabilidad |
| Frecuencia de consulta | Baja, ante una sospecha | Alta: reportes, KPIs, alertas |

Se adoptan seis reglas para que la frontera no dependa de que alguien la recuerde:

1. **Test de decisión.** ¿Cambió la cantidad física de unidades? → `movimientos`. ¿Cambió el valor
   de un campo de un registro? → `auditoria`. Ante la duda, es auditoría.
2. **Sin doble escritura.** Un movimiento **ya se audita a sí mismo**: lleva `usuario_id`, `fecha`,
   `motivo` y `stock_resultante`. Nunca se escribe una fila de `auditoria` por un movimiento. El
   ajuste con `es_discrepancia` de #6, que parece necesitar ambas, queda cubierto por el ledger.
3. **La firma del servicio de auditoría no admite cantidades.** No hay parámetro donde entre un
   número de unidades. La frontera la impone el compilador, no la revisión de código.
4. **Ningún campo sensible entra en `datos_previos` / `datos_posteriores`.** El servicio mantiene
   una lista de exclusión explícita, encabezada por `hash_contrasena`. Un snapshot ingenuo de la
   fila de `usuarios` copiaría el hash de contraseña a una tabla pensada para que el encargado la
   lea, y lo repetiría en cada cambio. No es una decisión con alternativas: es una fuga.
5. **Dos tests fijan el límite.** Registrar una venta crea un `movimiento` y **ninguna** fila de
   auditoría; editar `stock_minimo` crea una fila de auditoría y **ningún** movimiento. Una regla
   en un documento se olvida; un test en rojo no.
6. **Nombres.** `auditoria` y `movimientos`. **No** se usa `historial` para ninguna de las dos:
   esa palabra significa las dos cosas y reintroduce la ambigüedad que este ADR resuelve.

## Alternativas consideradas

- **Una sola tabla de eventos** que registre todo lo que pasa en el sistema. Se descartó porque las
  reglas de negocio del ledger no tienen sentido fuera de él: los `CHECK` que atan el signo al tipo,
  `es_discrepancia` restringido a los ajustes y `stock_resultante` no significan nada para
  "alguien renombró un proveedor". Peor: con filas ajenas dentro, toda consulta de stock necesitaría
  filtrarlas, y se rompería la invariante **Σ(movimientos) = stock actual** sobre la que se apoyan
  el ADR-0003 y la verificación periódica de consistencia del backlog #14.
- **Una tabla de auditoría por entidad** (`usuario_auditoria`, `proveedor_auditoria`, …). Se
  descartó porque las decisiones difíciles —qué guardar del estado previo, qué excluir, cómo tratar
  la baja lógica— son las mismas para las tres entidades, y tomarlas por separado produce tres
  formas divergentes. Además obliga a un `UNION` de esquemas distintos para responder "qué hizo
  Juan la semana pasada".
- **No tener auditoría general y apoyarse solo en el ledger.** Es suficiente para el PRD, que solo
  pide auditar movimientos. Se descartó porque deja sin resolver el no-repudio del flujo de
  contraseña temporal de #3, que es la razón por la que #2.2 existe.

## Consecuencias

- La invariante del ledger sobrevive intacta: `movimientos` sigue conteniendo solo movimientos y la
  verificación de consistencia de #14 sigue siendo válida.
- Las decisiones de diseño de la auditoría se toman una sola vez, con usuarios, proveedores y
  productos a la vista, en el ciclo de #2.2.
- **Trade-off:** son dos tablas que mantener. Una vista global de "todo lo que pasó" necesita
  consultarlas por separado y unir los resultados en la aplicación.
- **Trade-off:** `auditoria` no tiene clave foránea sobre `entidad_id` (ver ADR-0011), así que nada
  en la base impide una fila huérfana. Queda a cargo del servicio y de sus tests.
- **Trade-off:** hay casos borde que van a discutirse. La baja lógica de un producto **con stock**
  es auditoría, no movimiento: las unidades siguen físicamente en el depósito, lo que cambió fue un
  campo del registro. La regla 1 lo resuelve y el test de la regla 5 lo deja fijado.
- **Trade-off:** la regla 2 implica que quien quiera "todo lo que hizo un usuario" debe mirar las
  dos tablas. Es el precio de no duplicar, y duplicar habría significado que las dos copias se
  desincronizaran.
