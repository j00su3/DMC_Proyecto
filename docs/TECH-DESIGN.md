# Technical Design Document: Sistema de Gestión de Inventario para Tiendas (InvenTienda)

> [!WARNING]
> **Documento superseded — no citar como fuente de decisiones vigentes.**
> `docs/TECH-DESIGNv2.md` reemplaza a este documento desde el 2026-08-13, incorporando
> las resoluciones de la Ronda 2 de `docs/REVISION-ADVERSARIAL.md`. Este archivo se
> conserva sólo como historial de la v1.
>
> Las secciones que cambiaron entre versiones son justamente las de los ítems aún no
> implementados (movimientos, punto de venta, alertas), de modo que citar la v1 al
> planificar trabajo nuevo produce decisiones sobre un diseño retirado. Ver
> `docs/DRIFT.md` (D-07).

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
- **Backend (API + lógica + alertas)** — Node.js + TypeScript. Concentra la lógica de negocio, la
  persistencia y la evaluación de alertas. Expone una API **REST/JSON documentada con OpenAPI**
  ([ADR-0004](adrs/0004-rest-json-openapi.md)), de la que se generan los tipos TS de la SPA.
- **Base de datos** — PostgreSQL ([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)).
  Almacena el estado (productos, stock, ventas, usuarios, sesiones) y el ledger de movimientos.

Comunicación: `SPA → (HTTP/JSON, cookie de sesión) → API → (SQL/transacciones) → Postgres`. Las
alertas se evalúan **dentro de la transacción** que confirma cada movimiento
([ADR-0008](adrs/0008-evaluador-de-alertas-detras-de-interfaz.md)), sin proceso aparte.

**Despliegue (v1):** local, en la máquina del desarrollador (Postgres vía Docker + backend Node
como proceso local), sin HTTPS — acceso por `localhost` ([ADR-0009](adrs/0009-despliegue-local.md)).
La decisión de subir el proyecto a un hosting queda abierta y se retoma más adelante; ese ADR fija
la condición de revisión (HTTPS, cookie `Secure`, backup fuera del disco principal) para cuando
eso ocurra o el sistema se acceda desde otros dispositivos en red.

## Decisiones de arquitectura

| # | Decisión | Estado |
|---|---|---|
| [ADR-0001](adrs/0001-monolito-api-spa.md) | Arquitectura de componentes — Monolito API + SPA en monorepo | Aceptado |
| [ADR-0002](adrs/0002-stack-node-react.md) | Stack — Node/TypeScript (backend) + React/TypeScript (frontend) | Aceptado |
| [ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md) | Modelo de datos — Postgres con stock guardado + ledger de movimientos | Aceptado |
| [ADR-0004](adrs/0004-rest-json-openapi.md) | Contrato de API — REST/JSON con OpenAPI | Aceptado |
| [ADR-0005](adrs/0005-update-atomico-condicional.md) | Concurrencia — Update atómico condicional sobre el stock | Aceptado |
| [ADR-0006](adrs/0006-bloquear-stock-insuficiente.md) | Resiliencia — Bloquear stock insuficiente (nunca negativo) | Aceptado |
| [ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md) | Auth — Sesión con cookie httpOnly + RBAC propio | Aceptado |
| [ADR-0008](adrs/0008-evaluador-de-alertas-detras-de-interfaz.md) | Alertas — Evaluador de reglas detrás de interfaz (puerta abierta a ML) | Aceptado |
| [ADR-0009](adrs/0009-despliegue-local.md) | Despliegue — Local en la máquina del desarrollador, con condición de revisión | Aceptado |

## Modelo de datos

Entidades principales derivadas del PRD y del Design.md. El stock vive como campo en **Producto** y
toda su modificación se asienta en **Movimiento** dentro de la misma transacción
([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)).

- **Usuario** — `id`, `nombre`, `email/usuario`, `hash_contraseña`, `rol` (`encargado` |
  `deposito`), `activo`, `creado_en`. El rol gobierna el RBAC ([ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md)).
  (El Design.md muestra avatar con iniciales y color por rol: azul encargado, verde depósito.)
- **Sesión** — `id`, `usuario_id`, `creada_en`, `expira_en`. Respalda la cookie httpOnly.
- **Proveedor** — `id`, `nombre`, `contacto`, `activo`. Un producto referencia a un proveedor.
  Caso borde "proveedor eliminado con productos asociados": baja lógica (`activo = false`), no
  borrado físico, para no romper referencias ni historial.
- **Producto** — `id`, `nombre`, `sku/codigo` (único → cubre "producto duplicado"), `categoria`,
  `stock_actual`, `stock_minimo` (puede ser nulo → afecta generación de alertas, ver riesgos),
  `precio`, `proveedor_id`, `activo` (la **baja** es lógica y reservada al encargado; un producto
  inactivo **no admite movimientos nuevos** — el UPDATE condicional exige `activo = true`, ver
  [ADR-0005](adrs/0005-update-atomico-condicional.md) — solo lectura de su historial; reactivarlo
  también es reservado al encargado). Chips de estado del Design.md (quiebre/bajo) se derivan de
  `stock_actual` vs `stock_minimo`.
- **Movimiento** (ledger) — `id`, `producto_id`, `tipo` (`entrada` | `salida` | `ajuste` |
  `venta`), `cantidad` (con signo: −2, +50; `CHECK` ata el signo al `tipo` — `entrada` > 0,
  `salida`/`venta` < 0, `ajuste` libre), `motivo` (obligatorio en ajustes y salidas de merma),
  `usuario_id`, `fecha`, `venta_id` (nulo salvo movimientos generados por una venta),
  `stock_resultante` (calculado dentro de la misma transacción que el update de stock). Es la
  traza de auditoría de todo cambio de stock ([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md)).
- **Venta** — `id`, `numero_correlativo`, `fecha`, `usuario_id` (cajero), `total`, `estado`
  (`confirmada` | `anulada`), `anulada_por`, `anulada_en`, `motivo_anulacion`. **Campos reservados
  para etapa 2 (factura fiscal), no usados en v1:** `tipo_comprobante`, `cae`, `numero_fiscal`
  ([ADR-0003](adrs/0003-postgres-stock-guardado-ledger.md), [ADR-0004](adrs/0004-rest-json-openapi.md)).
- **ItemVenta** — `id`, `venta_id`, `producto_id`, `cantidad`, `precio_unitario`, `subtotal`.
  (El POS del Design.md muestra carrito con ítems y subtotales.)
- **Pago** — `id`, `venta_id`, `medio` (`efectivo` | `tarjeta` | `transferencia` | `qr`), `monto`,
  `vuelto` (el Design.md resalta el vuelto en verde 22px), `estado` (`registrado` | `revertido`).
  El pago se **registra**, no se integra con pasarelas (No alcance del PRD). Al anular una venta,
  su `Pago.estado` pasa a `revertido` (ver Anulación, más abajo) — así "revertir el stock y la
  caja" (caso borde del PRD) queda cubierto sin modelar devoluciones parciales, que **no** son
  alcance de v1 (solo se soporta anulación **total** de la venta).
- **Recibo** — no es una tabla propia: se **deriva** on-demand de `Venta` + `ItemVenta` + `Pago`
  (ítems, importe, medio de pago, fecha, cajero, número correlativo) al pedir imprimir/descargar.
  Es seguro porque una Venta confirmada es inmutable (solo cambia su `estado` al anular, nunca sus
  ítems/importes); duplicar esos datos en una tabla aparte no aporta nada en v1. **Sin validez
  fiscal.**
- **Alerta** — `id`, `tipo` (`stock_bajo` | `quiebre` | `discrepancia` | `sugerencia_reposicion`),
  `producto_id`, `creada_en`, `estado` (`activa` | `vista` | `resuelta`), datos anti-ruido para no
  re-disparar en oscilaciones ([ADR-0008](adrs/0008-evaluador-de-alertas-detras-de-interfaz.md)).
  `sugerencia_reposicion` usa una heurística de v1 (promedio de salidas/ventas de 30 días, ver
  ADR-0008) — no es exclusiva de etapa 2, el PRD la pide como "best-effort" desde v1.

Trazabilidad Design.md → datos: KPI cards y chips (quiebre/bajo) ← `stock_actual`/`stock_minimo`;
tabla de movimientos con signo ← Movimiento; chips VENTA/AJUSTE/ENTRADA/ANULACIÓN ← `Movimiento.tipo`
/ `Venta.estado`; POS (catálogo, carrito, total, vuelto) ← Producto/ItemVenta/Pago; vista de
proveedores maestro-detalle ← Proveedor; matriz de permisos (✓/◐/✕) ← `Usuario.rol` + RBAC.

## Criterios de aceptación por flujo

### Autenticación y permisos (RBAC)

- [ ] Un usuario no autenticado que llama a cualquier endpoint de datos recibe 401 y es redirigido
      al login.
- [ ] La contraseña se guarda hasheada (bcrypt/argon2); en ningún log ni respuesta viaja en claro.
- [ ] Al iniciar sesión se crea una cookie `httpOnly`; al cerrar sesión o expirar, los endpoints
      vuelven a responder 401.
- [ ] El personal de depósito recibe 403 al intentar: anular/devolver una venta, dar de baja un
      producto, crear/editar proveedores, configurar umbrales, gestionar usuarios o configuración.
- [ ] El personal de depósito **sí** puede: ver inventario, registrar entradas, procesar ventas,
      registrar salidas, registrar ajustes **con motivo**, y dar de alta/editar productos.
- [ ] La autorización se valida en el backend aunque la SPA oculte o marque la acción con 🔒
      (probado llamando el endpoint directo con rol depósito).

### Gestión de productos

- [ ] Crear un producto con SKU ya existente es rechazado con mensaje claro (unicidad de código).
- [ ] La **baja** de un producto la puede hacer solo el encargado y es **lógica** (`activo=false`);
      el producto y su historial siguen consultables.
- [ ] Un producto sin `stock_minimo` definido se guarda, y el sistema indica que **no** generará
      alertas de stock bajo hasta definirlo (no lanza falsos disparos).
- [ ] Un producto con `activo=false` **rechaza** cualquier movimiento nuevo (venta, entrada, salida,
      ajuste); solo su historial sigue siendo consultable. Reactivarlo es exclusivo del encargado.

### Registro de movimiento (entrada / salida / ajuste)

- [ ] Cada movimiento confirmado actualiza `stock_actual` y crea un asiento en el ledger en la
      **misma transacción**; nunca uno sin el otro.
- [ ] Un ajuste sin motivo es rechazado; con motivo, queda registrado (fecha, usuario, motivo) y
      visible en el reporte de discrepancias del encargado.
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
- [ ] Al confirmar, la venta puede generarse como **recibo interno** (sin validez fiscal)
      imprimible/descargable en cualquier momento posterior — el recibo se deriva de
      `Venta`+`ItemVenta`+`Pago`, no requiere un registro propio.
- [ ] Si la venta no se confirma (cajero cierra la pantalla o se corta la conexión), **no** se
      descuenta stock (la transacción no se completó) — cubre "venta interrumpida".
- [ ] Una venta típica (agregar ítems + cobrar) se completa en **≤ 1 minuto** desde la pantalla de
      venta.

### Anulación / devolución de venta

- [ ] Solo el encargado puede anular/devolver una venta confirmada.
- [ ] Anular **revierte el stock** de los ítems (movimientos de reversión en el ledger) y marca la
      venta como `anulada` con usuario, fecha y motivo; **no** hay borrado silencioso.
- [ ] Anular una venta marca su `Pago.estado` como `revertido` (revierte también la caja, no solo
      el stock).
- [ ] El recibo derivado de una venta anulada refleja el estado `anulada` (hereda de `Venta.estado`,
      no requiere un campo propio), conservando la traza.
- [ ] v1 solo soporta anulación **total** de una venta confirmada; la devolución parcial de ítems
      queda fuera de alcance (puerta abierta a futuro, no implementada).

### Alertas

- [ ] Cuando un movimiento hace que `stock_actual` cruce el `stock_minimo` (o llegue a 0), se
      genera la alerta de stock bajo/quiebre **dentro de la transacción** del movimiento (objetivo
      < 1 minuto cumplido por construcción).
- [ ] Un ajuste marcado como discrepancia genera una alerta de discrepancia visible para el
      encargado.
- [ ] Un producto que oscila alrededor del umbral **no** genera alertas repetidas/ruido (control
      anti-duplicado en el evaluador).
- [ ] Un producto cuyo `stock_actual` cae por debajo de N veces su promedio de salidas/ventas de
      los últimos 30 días genera `sugerencia_reposicion` (heurística best-effort de v1, no ML).
- [ ] La evaluación de alertas está detrás de la interfaz `EvaluadorDeAlertas`; sustituir
      `ReglasUmbral` por otra implementación no requiere tocar los flujos de movimiento/venta.
- [ ] Un fallo del evaluador de alertas **no** revierte el movimiento/venta que lo disparó (se
      registra el error y la operación se confirma igual).
- [ ] Mientras haya sesión activa, la SPA refleja alertas nuevas sin necesidad de recargar toda la
      pantalla (polling periódico del conteo de alertas activas) — cubre la entrega al usuario, no
      solo la creación del registro; el push en vivo real queda para etapa 2.

### Reportes

- [ ] El encargado ve reportes de stock actual, bajo mínimo, movimientos por período y
      **discrepancias globales**; el personal de depósito ve solo reportes operativos (stock, bajo
      mínimo, sus propios movimientos) y **no** el de discrepancias globales.
- [ ] Un reporte sobre un período sin movimientos muestra un **estado vacío** explícito (distinto
      de un error).

### Gestión de proveedores

- [ ] El encargado da de alta/edita proveedores; el personal de depósito solo los consulta (para
      asociarlos a movimientos), recibiendo 403 al intentar crear/editar.
- [ ] Eliminar un proveedor con productos asociados es una **baja lógica**; los productos
      conservan la referencia y el historial no se rompe.

## Riesgos técnicos abiertos

- **Redundancia stock ↔ ledger:** `stock_actual` es un derivado del ledger; un bug que rompa la
  atomicidad podría divergirlos. Mitigación: toda escritura pasa por la transacción y se agrega una
  **verificación periódica de consistencia** (stock vs suma del ledger). Revisar antes de producción.
- **Productos sin `stock_minimo`:** el PRD marca el caso "datos incompletos". Se resolvió no
  generando alertas para ellos; validar con la operación si conviene forzar un mínimo al alta.
- **Política "nunca negativo" vs realidad física:** [ADR-0006](adrs/0006-bloquear-stock-insuficiente.md)
  obliga a un ajuste/entrada cuando la mercadería ya salió sin registrarse. Validar con la operación
  real que no genere fricción inaceptable en caja; la regla mixta quedó como alternativa.
- **Calibración de alertas:** riesgo del PRD de alertas mal calibradas (ruido o silencio) que
  erosionan la confianza. El control anti-ruido es un primer paso; requiere ajuste con datos reales.
- **Concurrencia y regla de negocio en SQL:** la condición `stock >= :n` vive parcialmente en el
  SQL ([ADR-0005](adrs/0005-update-atomico-condicional.md)); mantenerla sincronizada con el dominio
  y cubierta por tests. Las ventas multi-ítem con rollback parcial necesitan tests de concurrencia,
  incluido el caso de dos ventas concurrentes con productos superpuestos (mitigado con orden
  determinístico de ítems, pero a validar con tests reales de concurrencia).
- **Seguridad propia:** al no usar proveedor externo ([ADR-0007](adrs/0007-sesion-cookie-rbac-propio.md)),
  el proyecto asume hashing, manejo de sesión, **protección CSRF** (por cookies), rate-limit/lockout
  de login, bootstrap del primer encargado y reset de contraseña. Revisar checklist de seguridad
  antes de producción.
- **Despliegue local sin HTTPS:** mientras el sistema corra solo en la máquina del desarrollador
  ([ADR-0009](adrs/0009-despliegue-local.md)), la integridad de los datos depende de un backup
  manual/programado fuera del disco principal, y la cookie de sesión no tiene `Secure`. Ambas cosas
  deben revisarse antes de acceder desde otro dispositivo en red o de desplegar en un hosting.
- **Puertas de etapa 2 abiertas pero no probadas:** los campos fiscales reservados en Venta, la
  separación API/SPA para push en vivo, y la interfaz de alertas para ML reducen el costo futuro,
  pero ninguna de las tres integraciones fue validada extremo a extremo en v1.
