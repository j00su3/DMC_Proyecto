# Technical Design Document v2: Sistema de Gestión de Inventario para Tiendas (InvenTienda)

**Versión:** 2 — 2026-08-13. Supersede a `TECH-DESIGN.md` (v1).
**Motivo de la versión:** incorpora las resoluciones de la **Ronda 2** de la revisión adversarial
(`REVISION-ADVERSARIAL.md`): 2 Críticos (C1–C2), 5 Advertencias (A7–A11) y 5 Sugerencias (S6–S10).
La sección [Cambios respecto de v1](#cambios-respecto-de-v1-resolución-ronda-2) mapea cada hallazgo
con su decisión. Los ADRs afectados (0002, 0005, 0007, 0008, 0009) fueron actualizados el
2026-08-13 y están alineados con este documento.

**Tipo de proyecto:** Greenfield — se construye desde cero, sin repos previos que reconciliar.
**Design.md disponible:** Sí — el modelo de datos se derivó del PRD y también de lo que las
pantallas del Design.md revelan que el usuario debe ver (chips de estado, KPIs, tablas de
movimientos con signo, POS con carrito y vuelto, recibo interno).

## Resumen

InvenTienda es una aplicación web multiusuario para el control de inventario de una tienda de
**un único local** (segmento retail medio), que reemplaza la gestión por planillas/memoria. Cubre
gestión de productos y proveedores, movimientos de inventario (entradas, salidas, ajustes) con
historial auditable, un **punto de venta** que procesa ventas, registra el pago y descuenta stock
automáticamente emitiendo un recibo interno (sin validez fiscal), **alertas** por reglas/umbral
(stock bajo, quiebre, discrepancias) y **reportes** de stock, bajo mínimo, movimientos y
discrepancias. El objetivo es una fuente única y actualizada del inventario, con stock que refleja
cada movimiento al confirmarse y auditoría completa de quién hizo qué y por qué. El diseño deja la
puerta abierta a tres evoluciones que el PRD marca para etapa 2 / futuro: **factura fiscal
electrónica**, **push en vivo** entre dispositivos y **motor de ML** de predicción de demanda.

## Arquitectura de componentes

Dos componentes en un **monorepo liviano** (ver [ADR-0001](adrs/0001-monolito-api-spa.md)):

- **Frontend (SPA)** — React + TypeScript ([ADR-0002](adrs/0002-stack-node-react.md)). Renderiza
  las vistas del Design.md (dashboard/KPIs, inventario, movimientos, POS, proveedores, reportes,
  alertas, usuarios). Consume la API por HTTP/JSON. Usa el rol del usuario solo para mostrar/marcar
  con 🔒; **no** es la fuente de verdad de los permisos.
  - **Estado del frontend (nuevo en v2, resuelve S9):** el estado de servidor (productos, alertas,
    reportes) se maneja con **TanStack Query** (fetch + cache + refetch + el polling de alertas ya
    decidido). El **carrito del POS** vive en la SPA y se **persiste en `localStorage`** por
    dispositivo (clave asociada al usuario): una recarga accidental, un cierre de pestaña o un
    corte de conexión **no pierden el carrito** — se restaura al volver a la pantalla de venta. El
    carrito se limpia al confirmar la venta o al vaciarlo explícitamente. No se comparte entre
    dispositivos (coherente con "sin push en vivo" en v1).
- **Backend (API + lógica + alertas)** — Node.js + TypeScript. Concentra la lógica de negocio, la
  persistencia y la evaluación de alertas. Expone una API **REST/JSON documentada con OpenAPI**
  ([ADR-0004](adrs/0004-rest-json-openapi.md)), de la que se generan los tipos TS de la SPA.
  - **Framework y ORM (nuevo en v2, resuelve S8):** **Fastify** con `fastify-type-provider-zod` —
    los schemas Zod definidos una vez validan las requests en runtime **y** generan el documento
    OpenAPI, cumpliendo el pipeline code-first del ADR-0004 sin herramientas paralelas. ORM:
    **Drizzle** — SQL-first, deja escribir tal cual el UPDATE atómico condicional y las
    transacciones/savepoints que exigen los ADR-0005/0008, sin abandonar los tipos. Sesiones en
    Postgres vía `@fastify/cookie` + almacén propio; rate-limit de login con `@fastify/rate-limit`.
- **Base de datos** — PostgreSQL ([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)).
  Almacena el estado (productos, stock, ventas, usuarios, sesiones) y el ledger de movimientos.

Comunicación: `SPA → (HTTP/JSON, cookie de sesión) → API → (SQL/transacciones) → Postgres`. Las
alertas se evalúan **dentro de la transacción** de cada movimiento, protegidas por un
**`SAVEPOINT`** (ver [Evaluación de alertas](#evaluación-de-alertas-detalle-v2), resuelve C1).

**Despliegue:** SPA en Vercel, API en Render (tier gratuito) y Postgres gestionado en Neon —
`vercel.json` reescribe `/api/*` hacia Render para conservar un único origen y que la cookie de
sesión siga funcionando sin CORS ([ADR-0010](adrs/0010-despliegue-tiers-gratuitos.md), que
reemplaza a [ADR-0009](adrs/0009-despliegue-local.md)). Docker Compose se mantiene para Postgres de
desarrollo local. El HTTPS gratuito de estos proveedores habilita `Secure` en la cookie
([ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md)) y resuelve la condición de revisión de
producto agregada en v2 (A11): ver [Riesgos](#riesgos-técnicos-abiertos).

## Decisiones de arquitectura

| # | Decisión | Estado |
|---|---|---|
| [ADR-0001](adrs/0001-monolito-api-spa.md) | Arquitectura de componentes — Monolito API + SPA en monorepo | Aceptado |
| [ADR-0002](adrs/0002-stack-node-react.md) | Stack — Node/TS + React/TS, con Fastify + Drizzle + TanStack Query | Aceptado — actualizado (S8/S9) |
| [ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md) | Modelo de datos — Postgres con stock guardado + ledger de movimientos | Aceptado — **v2 cierra el bypass del ledger en alta/edición (C2)** |
| [ADR-0004](adrs/0004-rest-json-openapi.md) | Contrato de API — REST/JSON con OpenAPI (code-first Zod) | Aceptado |
| [ADR-0005](adrs/0005-update-atomico-condicional.md) | Concurrencia — Update atómico condicional sobre el stock | Aceptado — actualizado (A8) |
| [ADR-0006](adrs/0006-bloquear-stock-insuficiente.md) | Resiliencia — Bloquear stock insuficiente (nunca negativo) | Aceptado |
| [ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md) | Auth — Sesión con cookie httpOnly + RBAC propio | Aceptado — actualizado (A7, S10) |
| [ADR-0008](adrs/0008-evaluador-de-alertas-detras-de-interfaz.md) | Alertas — Evaluador de reglas detrás de interfaz | Aceptado — actualizado (C1, S7, A10) |
| [ADR-0009](adrs/0009-despliegue-local.md) | Despliegue — Local en la máquina del desarrollador | Reemplazado por [ADR-0010](adrs/0010-despliegue-tiers-gratuitos.md) |
| [ADR-0010](adrs/0010-despliegue-tiers-gratuitos.md) | Despliegue — Tiers gratuitos (Vercel + Render + Neon) | Aceptado |
| [ADR-0011](adrs/0011-claves-primarias-uuid.md) | Modelo de datos — Claves primarias UUID para las entidades de dominio | Aceptado |
| [ADR-0012](adrs/0012-frontera-auditoria-y-ledger.md) | Modelo de datos — Frontera entre el ledger de movimientos y la auditoría de registros | Aceptado |

## Modelo de datos

Entidades principales derivadas del PRD y del Design.md. El stock vive como campo en **Producto** y
toda su modificación se asienta en **Movimiento** dentro de la misma transacción
([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)). **Invariante reforzado en v2 (C2): no
existe ningún camino de escritura de `stock_actual` que no genere un asiento en el ledger — ni
siquiera el alta o la edición de producto.**

- **Usuario** — `id`, `nombre`, `email/usuario`, `hash_contraseña`, `rol` (`encargado` |
  `deposito`), `activo`, `creado_en`. El rol gobierna el RBAC ([ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md)).
  (El Design.md muestra avatar con iniciales y color por rol: azul encargado, verde depósito.)
- **Sesión** — `id`, `usuario_id`, `creada_en`, `expira_en`. Respalda la cookie httpOnly. La cookie
  lleva `httpOnly` + **`SameSite=Lax`** desde v1 (resuelve S10; `Secure` queda condicionado al
  despliegue, ver ADR-0009).
- **Proveedor** — `id`, `nombre`, `contacto`, `activo`. Un producto referencia a un proveedor.
  Caso borde "proveedor eliminado con productos asociados": baja lógica (`activo = false`), no
  borrado físico, para no romper referencias ni historial.
- **Producto** — `id`, `nombre`, `sku/codigo` (único → cubre "producto duplicado"), `categoria`,
  `stock_actual`, `stock_minimo` (puede ser nulo → afecta generación de alertas, ver riesgos),
  `precio` (**`NUMERIC(12,2)`**, nunca float — S10), `proveedor_id`, `activo` (la **baja** es
  lógica y reservada al encargado; un producto inactivo **no admite movimientos nuevos** — con la
  **única excepción de la reversión por anulación de venta**, ver A8 — solo lectura de su
  historial; reactivarlo también es reservado al encargado). Chips de estado del Design.md
  (quiebre/bajo) se derivan de `stock_actual` vs `stock_minimo`.
  - **Stock inicial (resuelve C2):** el formulario de alta acepta un stock inicial, pero la API
    **no escribe `stock_actual` directo**: si el stock inicial es > 0, la misma transacción del
    alta crea un **Movimiento tipo `ajuste`** con motivo fijo "stock inicial (alta de producto)"
    y `es_discrepancia = false`. Un producto que nace con stock 0 no genera movimiento. Así la
    verificación de consistencia stock vs Σ(ledger) da 0 de diferencia desde el día uno.
  - **Edición (resuelve C2):** el schema de edición de producto **no acepta `stock_actual`**
    (Zod lo excluye; el backend lo rechaza aunque venga en el payload). Toda corrección de stock
    pasa por un movimiento de ajuste con motivo. No hay canal de stock sin ledger.
  - **`stock_minimo` (resuelve A7):** es el umbral de alertas por producto y la matriz del PRD
    reserva "configurar umbrales" al encargado. Como el RBAC del ADR-0007 es por endpoint y este
    permiso es **por campo**, la regla vive explícitamente en la capa de servicio de producto:
    si el actor es rol `deposito` y el payload modifica `stock_minimo` (o lo setea en el alta),
    la operación responde 403 con código de error propio (`campo_reservado_encargado`). La SPA
    muestra el campo con 🔒 para depósito. Es el **único** permiso por campo del sistema; si
    aparece un segundo, se generaliza — hoy una regla explícita es más simple que un framework.
- **Movimiento** (ledger) — `id`, `producto_id`, `tipo` (`entrada` | `salida` | `ajuste` |
  `venta` | **`anulacion`**), `cantidad` (con signo: −2, +50; `CHECK` ata el signo al `tipo` —
  `entrada` > 0, `salida`/`venta` < 0, **`anulacion` > 0**, `ajuste` libre), `motivo`
  (obligatorio en ajustes y salidas de merma), **`es_discrepancia`** (`boolean`, default `false`,
  solo aplicable a `tipo = ajuste` — `CHECK`; resuelve A9), `usuario_id`, `fecha`, `venta_id`
  (obligatorio en `venta` y `anulacion`, nulo en el resto), `stock_resultante` (calculado dentro
  de la misma transacción que el update de stock). Es la traza de auditoría de todo cambio de
  stock ([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)) — **de stock, y solo de stock**:
  el rastro de cambios sobre registros (usuarios, proveedores, productos) es la tabla `auditoria`
  del backlog #2.2, que es otra cosa y no se mezcla con esta
  ([ADR-0012](adrs/0012-frontera-auditoria-y-ledger.md)).
  - **`anulacion` como tipo propio (resuelve A8):** la reversión de una venta anulada deja de ser
    un movimiento genérico: es `tipo = anulacion`, positivo, ligado a la `venta_id` original. El
    chip ANULACIÓN del Design.md mapea directo a este tipo.
  - **`es_discrepancia` (resuelve A9):** al registrar un ajuste, el usuario indica si es una
    **diferencia de inventario** (conteo físico ≠ sistema) o una corrección operativa normal.
    Solo los ajustes con `es_discrepancia = true` generan alerta de discrepancia y alimentan el
    reporte de discrepancias. "Marcado como discrepancia" pasa de frase suelta a columna.
- **Venta** — `id`, `numero_correlativo`, `fecha`, `usuario_id` (cajero), `total`
  (**`NUMERIC(12,2)`**), `estado` (`confirmada` | `anulada`), `anulada_por`, `anulada_en`,
  `motivo_anulacion`. **Campos reservados para etapa 2 (factura fiscal), no usados en v1:**
  `tipo_comprobante`, `cae`, `numero_fiscal`.
  - **`numero_correlativo` (resuelve S6):** en v1 se implementa con una **secuencia de Postgres**,
    aceptando y documentando que las ventas que hacen rollback dejan **huecos** en la numeración
    (un número faltante en la traza = venta que no llegó a confirmarse, no una venta borrada —
    esto queda dicho acá para que un auditor interno no lo malinterprete). La correlatividad
    **estricta** que exigirá la factura fiscal de etapa 2 **no** se apoya en este campo: usará
    `numero_fiscal` con un **contador propio en tabla, incrementado dentro de la transacción**
    de emisión. Las dos numeraciones quedan desacopladas por diseño.
- **ItemVenta** — `id`, `venta_id`, `producto_id`, `cantidad`, `precio_unitario`, `subtotal`
  (ambos **`NUMERIC(12,2)`**). (El POS del Design.md muestra carrito con ítems y subtotales.)
- **Pago** — `id`, `venta_id`, `medio` (`efectivo` | `tarjeta` | `transferencia` | `qr`), `monto`,
  `vuelto` (ambos **`NUMERIC(12,2)`**; el Design.md resalta el vuelto en verde 22px), `estado`
  (`registrado` | `revertido`). El pago se **registra**, no se integra con pasarelas (No alcance
  del PRD). Al anular una venta, su `Pago.estado` pasa a `revertido` — así "revertir el stock y
  la caja" queda cubierto sin modelar devoluciones parciales, que **no** son alcance de v1 (solo
  anulación **total**).
- **Recibo** — no es una tabla propia: se **deriva** on-demand de `Venta` + `ItemVenta` + `Pago`
  (ítems, importe, medio de pago, fecha, cajero, número correlativo) al pedir imprimir/descargar.
  Es seguro porque una Venta confirmada es inmutable (solo cambia su `estado` al anular, nunca sus
  ítems/importes). **Sin validez fiscal.**
- **Alerta** — `id`, `tipo` (`stock_bajo` | `quiebre` | `discrepancia` | `sugerencia_reposicion`),
  `producto_id`, `creada_en`, `estado` (`activa` | `vista` | `resuelta`), `resuelta_en`,
  `resuelta_por` (nulo si la resolución fue automática). El ciclo de vida completo y la regla
  anti-ruido se definen abajo (resuelve A10).

Trazabilidad Design.md → datos: KPI cards y chips (quiebre/bajo) ← `stock_actual`/`stock_minimo`;
tabla de movimientos con signo ← Movimiento; chips VENTA/AJUSTE/ENTRADA/ANULACIÓN ←
`Movimiento.tipo` (ANULACIÓN ahora es tipo propio) / `Venta.estado`; POS (catálogo, carrito, total,
vuelto) ← Producto/ItemVenta/Pago; vista de proveedores maestro-detalle ← Proveedor; matriz de
permisos (✓/◐/✕) ← `Usuario.rol` + RBAC.

## Evaluación de alertas (detalle v2)

Sustituye el mecanismo descrito en ADR-0008 en dos puntos y completa lo que faltaba definir.

**Mecanismo de aislamiento (resuelve C1).** El evaluador sigue corriendo **dentro de la
transacción** del movimiento (se conserva el "< 1 minuto por construcción"), pero envuelto en un
**`SAVEPOINT`**: antes de invocar `EvaluadorDeAlertas` se emite `SAVEPOINT alertas`; si el
evaluador falla — **incluidos errores SQL** (constraint del INSERT de alerta, error en la consulta
del promedio de 30 días), no solo excepciones de JS — se ejecuta `ROLLBACK TO SAVEPOINT alertas`,
se loguea el error y la transacción del movimiento **continúa y confirma**. Un try/catch de
aplicación solo no alcanza: en Postgres un error SQL aborta la transacción entera (`25P02`) y el
COMMIT posterior haría rollback de la venta — exactamente el caso que el ADR-0008 declara
inaceptable. La alternativa (evaluar post-commit) se descartó porque el SAVEPOINT cuesta una línea
y conserva intacta la garantía de atomicidad alerta+movimiento cuando el evaluador funciona.

**Ciclo de vida de la alerta (resuelve A10).**

- **Creación — regla de cruce:** una alerta `stock_bajo` se crea solo cuando el movimiento hace
  **cruzar** el umbral hacia abajo (`stock_previo > stock_minimo` y `stock_resultante ≤
  stock_minimo`); `quiebre`, cuando cruza a 0. Un movimiento que deja el stock bajo el umbral pero
  que **ya estaba** bajo el umbral no crea nada — esto elimina el ruido de oscilación en origen.
- **De-duplicación:** no se crea una alerta si ya existe una del mismo `producto_id` + `tipo` en
  estado `activa` o `vista`. `vista` significa "el encargado la leyó", **no** "se resolvió": una
  alerta vista sigue bloqueando duplicados. Solo `resuelta` cierra el ciclo y habilita un nuevo
  disparo futuro.
- **Resolución automática:** `stock_bajo` se resuelve sola cuando un movimiento deja
  `stock_actual > stock_minimo`; `quiebre`, cuando deja `stock_actual > 0`. La resuelve el propio
  evaluador (misma transacción, mismo SAVEPOINT), con `resuelta_por` nulo. Esto aplica sea cual
  sea la causa del incremento — entrada, ajuste **o anulación de una venta** (la anulación que
  repone stock resuelve la alerta que esa venta disparó).
- **Resolución manual:** `discrepancia` y `sugerencia_reposicion` no tienen condición automática
  de salida; las resuelve el **encargado** desde la UI (`resuelta_por` = usuario).

**Heurística de `sugerencia_reposicion` (resuelve S7).** Definición operativa única:

- `promedio_diario` = unidades salidas del producto (tipos `venta` y `salida`) en los últimos 30
  días ÷ 30. Es un promedio **diario en unidades/día**, no el total del período.
- `cobertura_dias` = `stock_actual` ÷ `promedio_diario`.
- Se genera `sugerencia_reposicion` cuando `cobertura_dias < N`, con **N = 14 días** (constante
  fija en v1, configurable a futuro, no aprendida).
- **Historia insuficiente:** el producto necesita ≥ 7 días desde su primer movimiento; si tiene
  entre 7 y 30 días, el promedio se calcula sobre los días disponibles. Con menos de 7 días no se
  evalúa (evita sugerencias basadas en un pico de un día).
- **Sin salidas en el período** (`promedio_diario = 0`): no se sugiere nunca — declarado
  explícitamente; los productos sin rotación quedan cubiertos por `stock_bajo`/`quiebre`, no por
  esta regla.

## Criterios de aceptación por flujo

### Autenticación y permisos (RBAC)

- [ ] Un usuario no autenticado que llama a cualquier endpoint de datos recibe 401 y es redirigido
      al login.
- [ ] La contraseña se guarda hasheada (bcrypt/argon2); en ningún log ni respuesta viaja en claro.
- [ ] Al iniciar sesión se crea una cookie `httpOnly` con **`SameSite=Lax`**; al cerrar sesión o
      expirar, los endpoints vuelven a responder 401.
- [ ] El personal de depósito recibe 403 al intentar: anular/devolver una venta, dar de baja un
      producto, crear/editar proveedores, configurar umbrales, gestionar usuarios o configuración.
- [ ] El personal de depósito **sí** puede: ver inventario, registrar entradas, procesar ventas,
      registrar salidas, registrar ajustes **con motivo**, y dar de alta/editar productos.
- [ ] **(A7)** Un alta o edición de producto con rol depósito que incluya `stock_minimo` responde
      403 con código `campo_reservado_encargado`; la misma operación sin ese campo se acepta. El
      encargado puede modificarlo normalmente.
- [ ] La autorización se valida en el backend aunque la SPA oculte o marque la acción con 🔒
      (probado llamando el endpoint directo con rol depósito).

### Gestión de productos

- [ ] Crear un producto con SKU ya existente es rechazado con mensaje claro (unicidad de código).
- [ ] **(C2)** Dar de alta un producto con stock inicial > 0 crea, en la misma transacción, un
      Movimiento `ajuste` con motivo "stock inicial (alta de producto)"; la suma del ledger del
      producto coincide con `stock_actual` desde el alta. Con stock inicial 0 no se crea movimiento.
- [ ] **(C2)** El endpoint de edición de producto rechaza cualquier payload que incluya
      `stock_actual` (el campo no existe en el schema); el stock solo cambia vía movimientos.
- [ ] La **baja** de un producto la puede hacer solo el encargado y es **lógica** (`activo=false`);
      el producto y su historial siguen consultables.
- [ ] Un producto sin `stock_minimo` definido se guarda, y el sistema indica que **no** generará
      alertas de stock bajo hasta definirlo (no lanza falsos disparos).
- [ ] Un producto con `activo=false` **rechaza** cualquier movimiento nuevo (venta, entrada,
      salida, ajuste) — con la única excepción de la reversión por anulación (ver Anulación);
      solo su historial sigue siendo consultable. Reactivarlo es exclusivo del encargado.

### Registro de movimiento (entrada / salida / ajuste)

- [ ] Cada movimiento confirmado actualiza `stock_actual` y crea un asiento en el ledger en la
      **misma transacción**; nunca uno sin el otro.
- [ ] Un ajuste sin motivo es rechazado; con motivo, queda registrado (fecha, usuario, motivo) y
      es consultable en el historial.
- [ ] **(A9)** Al registrar un ajuste, el usuario indica si es una discrepancia de inventario;
      solo los ajustes con `es_discrepancia = true` aparecen en el reporte de discrepancias y
      generan alerta de discrepancia. Un ajuste con `es_discrepancia = true` y tipo distinto de
      `ajuste` es rechazado por el `CHECK`.
- [ ] Una salida por consumo/merma mayor al stock disponible se **rechaza** (nunca deja negativo);
      el stock resultante nunca es < 0.
- [ ] El flujo de alta de un movimiento desde la pantalla principal se completa en **≤ 3 pasos**.
- [ ] Cada movimiento queda auditable: consultar un producto muestra su historial con fecha,
      usuario, tipo, cantidad con signo y motivo.

### Punto de venta (venta + pago + recibo)

- [ ] Confirmar una venta descuenta el stock de **todos** sus ítems y crea los movimientos tipo
      `venta` asociados, en una **única transacción**; si un ítem no tiene stock, se rechaza la
      venta completa y **ningún** ítem se descuenta (rollback).
- [ ] Una venta que pide más unidades que el stock disponible es rechazada con "stock insuficiente:
      hay N"; el stock nunca queda negativo.
- [ ] No se puede confirmar una venta sin indicar el medio de pago; si el monto cobrado es menor al
      total, la confirmación se bloquea; si es mayor, se calcula y muestra el **vuelto**.
- [ ] Toda venta confirmada queda registrada como transacción con `numero_correlativo`, fecha,
      cajero, ítems, importe y medio de pago (**0 ventas sin su descuento de stock asociado**).
- [ ] **(S6)** Una venta que hace rollback consume un número de la secuencia sin romper nada: la
      numeración interna admite huecos y está documentado que un hueco = venta no confirmada.
- [ ] Al confirmar, la venta puede generarse como **recibo interno** (sin validez fiscal)
      imprimible/descargable en cualquier momento posterior — el recibo se deriva de
      `Venta`+`ItemVenta`+`Pago`, no requiere un registro propio.
- [ ] Si la venta no se confirma (cajero cierra la pantalla o se corta la conexión), **no** se
      descuenta stock (la transacción no se completó) — cubre "venta interrumpida".
- [ ] **(S9)** Si la pantalla del POS se recarga o la pestaña se cierra con un carrito armado sin
      confirmar, al volver a la pantalla de venta el carrito se **restaura** desde `localStorage`
      (mismo dispositivo y usuario); confirmar la venta o vaciarlo explícitamente lo limpia.
- [ ] Una venta típica (agregar ítems + cobrar) se completa en **≤ 1 minuto** desde la pantalla de
      venta.

### Anulación / devolución de venta

- [ ] Solo el encargado puede anular/devolver una venta confirmada.
- [ ] Anular **revierte el stock** de los ítems con movimientos tipo **`anulacion`** (positivos,
      ligados a la `venta_id`) y marca la venta como `anulada` con usuario, fecha y motivo; **no**
      hay borrado silencioso.
- [ ] **(A8)** Anular una venta cuyo producto fue dado de baja después de venderse **funciona**:
      los movimientos `anulacion` están exentos de la condición `activo = true` (la reversión de
      una operación pasada no es un "movimiento nuevo" de negocio). El producto inactivo puede
      quedar con stock > 0; ese stock solo se mueve de nuevo si el encargado lo reactiva.
- [ ] Anular una venta marca su `Pago.estado` como `revertido` (revierte también la caja, no solo
      el stock).
- [ ] El recibo derivado de una venta anulada refleja el estado `anulada` (hereda de `Venta.estado`,
      no requiere un campo propio), conservando la traza.
- [ ] v1 solo soporta anulación **total** de una venta confirmada; la devolución parcial de ítems
      queda fuera de alcance (puerta abierta a futuro, no implementada).

### Alertas

- [ ] **(A10)** Una alerta `stock_bajo`/`quiebre` se crea solo en el **cruce** del umbral
      (stock previo por encima, stock resultante en o por debajo), dentro de la transacción del
      movimiento (objetivo < 1 minuto cumplido por construcción).
- [ ] **(A10)** No se crea una alerta si ya existe una del mismo producto+tipo en estado `activa`
      o `vista`; un producto que oscila alrededor del umbral no genera alertas repetidas
      (verificable con la regla de cruce + de-duplicación).
- [ ] **(A10)** `stock_bajo` se resuelve automáticamente cuando el stock vuelve a superar el
      mínimo y `quiebre` cuando vuelve a ser > 0 — incluida la reposición por anulación de venta.
      `discrepancia` y `sugerencia_reposicion` se resuelven manualmente por el encargado.
- [ ] **(A9)** Un ajuste con `es_discrepancia = true` genera una alerta de discrepancia visible
      para el encargado; un ajuste normal no.
- [ ] **(S7)** Un producto con `cobertura_dias < 14` (según la definición operativa de la
      heurística) genera `sugerencia_reposicion`; un producto con promedio diario 0 o con menos de
      7 días de historia no la genera nunca.
- [ ] La evaluación de alertas está detrás de la interfaz `EvaluadorDeAlertas`; sustituir
      `ReglasUmbral` por otra implementación no requiere tocar los flujos de movimiento/venta.
- [ ] **(C1)** Un fallo del evaluador de alertas — **incluido un error SQL** (p. ej. una
      constraint violada en el INSERT de la alerta) — **no** revierte el movimiento/venta que lo
      disparó: el `ROLLBACK TO SAVEPOINT` descarta solo el trabajo del evaluador, el error se
      loguea y la transacción confirma. Test explícito: inyectar un error SQL en el evaluador y
      verificar que la venta confirma igual.
- [ ] Mientras haya sesión activa, la SPA refleja alertas nuevas sin necesidad de recargar toda la
      pantalla (polling periódico del conteo de alertas activas) — el push en vivo real queda para
      etapa 2.

### Reportes

- [ ] El encargado ve reportes de stock actual, bajo mínimo, movimientos por período y
      **discrepancias globales** (ajustes con `es_discrepancia = true`); el personal de depósito
      ve solo reportes operativos (stock, bajo mínimo, sus propios movimientos) y **no** el de
      discrepancias globales.
- [ ] Un reporte sobre un período sin movimientos muestra un **estado vacío** explícito (distinto
      de un error).

### Gestión de proveedores

- [ ] El encargado da de alta/edita proveedores; el personal de depósito solo los consulta (para
      asociarlos a movimientos), recibiendo 403 al intentar crear/editar.
- [ ] Eliminar un proveedor con productos asociados es una **baja lógica**; los productos
      conservan la referencia y el historial no se rompe.

## Riesgos técnicos abiertos

- **Redundancia stock ↔ ledger:** `stock_actual` es un derivado del ledger; un bug que rompa la
  atomicidad podría divergirlos. Mitigación: toda escritura pasa por la transacción (en v2 ya sin
  excepciones: el alta también asienta en el ledger — C2) y se agrega una **verificación periódica
  de consistencia** (stock vs suma del ledger). Revisar antes de producción.
- **Productos sin `stock_minimo`:** el PRD marca el caso "datos incompletos". Se resolvió no
  generando alertas para ellos; validar con la operación si conviene forzar un mínimo al alta.
- **Política "nunca negativo" vs realidad física:** [ADR-0006](adrs/0006-bloquear-stock-insuficiente.md)
  obliga a un ajuste/entrada cuando la mercadería ya salió sin registrarse. Validar con la operación
  real que no genere fricción inaceptable en caja; la regla mixta quedó como alternativa.
- **Calibración de alertas:** el ciclo de vida y la regla de cruce (v2) hacen el anti-ruido
  testeable, pero N = 14 días de cobertura y el promedio de 30 días son valores a priori; requieren
  ajuste con datos reales.
- **Concurrencia y regla de negocio en SQL:** la condición `stock >= :n` vive parcialmente en el
  SQL ([ADR-0005](adrs/0005-update-atomico-condicional.md)); mantenerla sincronizada con el dominio
  y cubierta por tests. Las ventas multi-ítem con rollback parcial necesitan tests de concurrencia,
  incluido el caso de dos ventas concurrentes con productos superpuestos (mitigado con orden
  determinístico de ítems, pero a validar con tests reales de concurrencia).
- **Seguridad propia:** al no usar proveedor externo ([ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md)),
  el proyecto asume hashing, manejo de sesión, **protección CSRF** (mitigada en gran parte con
  `SameSite=Lax` desde v1 — S10), rate-limit/lockout de login, bootstrap del primer encargado y
  reset de contraseña. Revisar checklist de seguridad antes de producción.
- **Despliegue local sin HTTPS:** mientras el sistema corra solo en la máquina del desarrollador
  ([ADR-0009](adrs/0009-despliegue-local.md)), la integridad de los datos depende de un backup
  manual/programado fuera del disco principal, y la cookie de sesión no tiene `Secure`.
- **(A11) Criterios de éxito inmedibles bajo `localhost`:** casi todos los criterios de éxito del
  PRD (≥ 30 % menos discrepancias, validar la matriz de permisos con la operación real, calibrar
  alertas con datos reales) requieren **usuarios reales operando el sistema** — algo que el
  despliegue local de una sola máquina excluye. El ADR-0009 ya incluye la **condición de revisión
  de producto** correspondiente, además de las técnicas: la decisión de despliegue debe revisarse
  **antes del primer ciclo de conteo real de inventario** (el hito que dispara la medición de los
  criterios de éxito), no solo cuando aparezca un evento de infraestructura. El riesgo queda
  abierto hasta que ese hito llegue y la decisión se tome.
- **Puertas de etapa 2 abiertas pero no probadas:** los campos fiscales reservados en Venta (con
  su contador fiscal propio ya decidido — S6), la separación API/SPA para push en vivo, y la
  interfaz de alertas para ML reducen el costo futuro, pero ninguna de las tres integraciones fue
  validada extremo a extremo en v1.

## Cambios respecto de v1 (resolución Ronda 2)

| Hallazgo | Decisión en v2 | Dónde |
|---|---|---|
| **C1** Política de error del evaluador inalcanzable | `SAVEPOINT` + `ROLLBACK TO SAVEPOINT` alrededor del evaluador; cubre errores SQL, conserva el "< 1 min por construcción" | Evaluación de alertas; criterio (C1) en Alertas |
| **C2** Stock inicial/edición saltean el ledger | Alta genera Movimiento `ajuste` "stock inicial"; edición excluye `stock_actual` del schema | Producto; criterios (C2) en Gestión de productos |
| **A7** `stock_minimo` editable por depósito | Permiso por campo en la capa de servicio: 403 `campo_reservado_encargado` para depósito | Producto; criterio (A7) en RBAC |
| **A8** Anulación bloqueada por `activo = true` | Tipo `anulacion` propio, exento de la condición `activo` | Movimiento; criterio (A8) en Anulación |
| **A9** "Marcado como discrepancia" sin modelo | Columna `Movimiento.es_discrepancia` (solo ajustes); filtra alerta y reporte | Movimiento; criterios (A9) |
| **A10** Ciclo de vida/anti-ruido indefinidos | Regla de cruce de umbral, de-dup por producto+tipo abierta, auto-resolución de stock_bajo/quiebre, resolución manual del resto | Evaluación de alertas; criterios (A10) |
| **A11** Criterios de éxito inmedibles | Condición de revisión del ADR-0009 atada también al hito "primer ciclo de conteo real" | Riesgos |
| **S6** `numero_correlativo` con huecos | Secuencia con huecos documentados en v1; `numero_fiscal` de etapa 2 con contador transaccional propio | Venta; criterio (S6) en POS |
| **S7** Heurística de reposición ambigua | Definición operativa: promedio diario, cobertura en días, N = 14, mínimo 7 días de historia, promedio 0 no sugiere | Evaluación de alertas; criterio (S7) |
| **S8** Framework/ORM sin fijar | **Fastify** (`fastify-type-provider-zod`) + **Drizzle** | Arquitectura de componentes |
| **S9** "¿Se pierde el carrito?" sin responder | Carrito en `localStorage` por dispositivo/usuario; TanStack Query para estado de servidor | Arquitectura; criterio (S9) en POS |
| **S10** NUMERIC y `SameSite` | `NUMERIC(12,2)` en todo campo monetario; cookie `SameSite=Lax` desde v1 | Modelo de datos; Sesión; criterio en RBAC |

**ADRs actualizados el 2026-08-13** para reflejar estas decisiones: 0002 (stack fijado), 0005
(exención de `anulacion`), 0007 (permiso por campo + `SameSite`), 0008 (SAVEPOINT, heurística,
ciclo de vida), 0009 (condición de revisión por hito de producto).
