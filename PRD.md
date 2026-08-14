---
title: "Sistema de Gestión de Inventario para Tiendas"
---

# PRD: Sistema de Gestión de Inventario para Tiendas

## Problema

Las tiendas pierden dinero por errores de inventario: stock que figura disponible pero no
está, productos que se agotan sin aviso, diferencias entre el conteo físico y el registrado, y
gestión manual de proveedores propensa a olvidos y demoras. Hoy muchas tiendas dependen de
planillas o de la memoria del encargado, lo que hace que los errores se detecten tarde —
cuando ya generaron pérdida (venta perdida, producto vencido, compra duplicada o faltante).

Importa ahora porque cada error de inventario tiene costo directo (mercadería perdida) e
indirecto (tiempo de corrección, ventas no concretadas, decisiones de compra mal informadas).

Segmento objetivo: **retail medio** (tiendas con volumen de productos y movimientos que ya no se
gestionan bien con planillas, pero de un solo local).

## Usuario objetivo

Tiendas que manejan inventario físico de productos y necesitan controlar stock, movimientos y
proveedores. Usuarios principales dentro de la tienda:

- **Encargado / administrador**: revisa reportes, alertas y toma decisiones de compra. Acceso
  completo, incluida la gestión de usuarios y las operaciones sensibles (ajustes de inventario,
  bajas, configuración).
- **Personal de depósito**: registra entradas, salidas y movimientos del día a día. Acceso
  operativo, sin gestión de usuarios ni operaciones sensibles.

El sistema es **multiusuario con roles**: cada persona ingresa con su propia cuenta y sus permisos
dependen del rol asignado. Esta versión define **dos roles**.

### Matriz de permisos por rol

Leyenda: ✅ permitido · 🔒 permitido con condición · ❌ no permitido.

| Funcionalidad                                   | Encargado/Admin | Personal de depósito |
| ----------------------------------------------- | :-------------: | :------------------: |
| Ver inventario y stock actual                   |       ✅        |          ✅          |
| Ver reportes                                    |       ✅        |     🔒 (operativos)  |
| Ver / recibir alertas                           |       ✅        |          ✅          |
| Registrar **entradas** (reposición/compra)      |       ✅        |          ✅          |
| **Procesar ventas** y registrar pagos           |       ✅        |          ✅          |
| **Anular / devolver** una venta                 |       ✅        |          ❌          |
| Registrar **salidas** (consumo/merma)           |       ✅        |          ✅          |
| Registrar **ajustes** (corrección/merma)        |       ✅        |   🔒 (con motivo)    |
| Alta / edición de productos                     |       ✅        |    🔒 (alta/edición) |
| **Baja** de productos                           |       ✅        |          ❌          |
| Gestión de proveedores                          |       ✅        |     🔒 (solo ver)    |
| Configurar umbrales de stock / alertas          |       ✅        |          ❌          |
| Gestión de usuarios y roles                     |       ✅        |          ❌          |
| Configuración del sistema                       |       ✅        |          ❌          |

Notas sobre las condiciones (🔒):

- **Ajustes de inventario**: operación sensible porque puede enmascarar pérdidas o robos. En v1 el
  ajuste del personal de depósito es **directo auditado**: se aplica de inmediato, exige **motivo
  obligatorio** y queda registrado (fecha, usuario, motivo) y visible en el reporte de discrepancias
  del encargado. El esquema de aprobación previa se pospone como posible mejora futura.
- **Reportes**: el personal de depósito ve reportes operativos (stock, bajo mínimo, sus propios
  movimientos); los reportes de gestión/valor y el de discrepancias globales quedan para el
  encargado.
- **Productos**: el personal puede dar de alta y editar datos operativos; la **baja** queda
  reservada al encargado para evitar borrados que oculten faltantes.
- **Proveedores**: el personal puede consultarlos (para asociarlos a movimientos), pero no
  crearlos/editarlos.
- **Ventas y anulaciones**: el personal de depósito puede **procesar ventas** (actúa como cajero) y
  registrar el pago, pero **anular o devolver** una venta ya confirmada queda reservado al encargado
  por ser una operación sensible (afecta stock, caja y comprobantes).

Contexto de uso: operación diaria de la tienda, desde el navegador (aplicación web), con
necesidad de ver el estado del inventario "en tiempo real" a medida que ocurren los movimientos.

Alcance de local: **un único local** en esta versión.

## Objetivo / resultado esperado

Que la tienda tenga una fuente única y actualizada de su inventario, de modo que:

- Los movimientos de productos (entradas, salidas, ajustes) queden registrados y reflejados al
  momento.
- El encargado reciba alertas antes de que un problema se convierta en pérdida (stock bajo,
  quiebre, discrepancias).
- Las compras a proveedores se decidan con datos, no de memoria.
- Se reduzcan las pérdidas atribuibles a errores de inventario respecto de la gestión manual
  previa.

## Alcance (qué sí incluye esta versión)

- **Usuarios y roles**: acceso con cuenta individual (login) y control de permisos por rol
  (encargado con acceso completo, personal de depósito con acceso operativo). Alta/edición de
  usuarios reservada al rol encargado/administrador.
- **Gestión de productos**: alta, edición y baja de productos con datos básicos (nombre, SKU/código,
  categoría, stock actual, stock mínimo, precio, proveedor asociado).
- **Movimientos de inventario**: registro de entradas (compras/reposición), salidas (consumo/merma)
  y ajustes (correcciones de conteo), con historial por producto. Las **ventas** generan
  automáticamente la salida de stock correspondiente (ver Punto de venta).
- **Punto de venta (ventas y pagos)**: procesar ventas al cliente — seleccionar productos, calcular
  el total, registrar el **pago** (efectivo y otros medios) y descontar el stock de forma automática
  al confirmar la venta. Cada venta queda registrada como transacción con fecha, usuario (cajero),
  ítems, importe y medio de pago.
- **Comprobante interno de venta**: al confirmar la venta se emite un **recibo/ticket interno**
  (sin validez fiscal) con los ítems, importe, medio de pago, fecha, cajero y número de venta
  correlativo. Queda asociado a la transacción y es imprimible/descargable. La **factura fiscal
  electrónica** (integración con organismo fiscal, CAE, tipos de comprobante) queda para una
  **etapa 2**, fuera del alcance de v1.
- **Gestión de proveedores**: alta/edición de proveedores y asociación producto–proveedor.
- **Actualización de stock en tiempo real**: cada movimiento actualiza el stock disponible al momento
  de registrarse — aplica a **compras/entradas**, **salidas**, **ajustes** y **restock/reposición**.
  El stock mostrado refleja el resultado de la operación apenas se confirma. En v1 la actualización
  se ve al cargar/recargar la pantalla (sin push en vivo entre dispositivos); el refresco automático
  en vivo queda para una versión futura.
- **Reportes**: stock actual, productos bajo mínimo, movimientos por período, y discrepancias
  detectadas en ajustes.
- **Alertas inteligentes**: notificaciones por stock bajo/quiebre, por diferencias de inventario y
  (best-effort) sugerencias de reposición según consumo histórico. En v1 se implementan con
  **reglas y umbrales** (stock mínimo, detección de discrepancias). El motor está pensado para
  **evolucionar hacia modelos de ML** (p. ej. predicción de demanda/reposición) en versiones
  posteriores; ML no es parte del alcance funcional de v1, pero **no se descarta** y el diseño debe
  dejar la puerta abierta.

## No alcance (qué explícitamente no incluye esta versión)

- **Facturación fiscal / electrónica con validez legal**: **no en v1** — la venta emite solo un
  recibo interno. La factura electrónica con integración al organismo fiscal (CAE, numeración
  fiscal, tipos A/B/C) queda planificada para **etapa 2**; el diseño de la venta debe dejar la
  puerta abierta para incorporarla sin rehacer el flujo.
- **Integración con procesadores de pago / cobro con tarjeta o QR en línea**: en v1 el pago se
  **registra** (medio: efectivo, tarjeta, transferencia, QR; y monto), pero **no** se integra con
  pasarelas, terminales POS ni cobro automático — el cobro real se realiza por fuera del sistema.
- **Predicción de demanda con modelos de machine learning**: **no en v1** — las alertas de esta
  versión se basan en reglas y umbrales. El ML queda como **evolución planificada** (roadmap
  futuro), no como exclusión definitiva; el diseño debe dejar la puerta abierta para incorporarlo.
- **Integración con proveedores externos** (pedidos automáticos, EDI, catálogos externos).
- **Gestión multi-sucursal / transferencias entre locales** (esta versión es de un único local).
- **Contabilidad, costos avanzados o valuación de inventario** (FIFO/LIFO, márgenes, impuestos).
- **App móvil nativa dedicada**: la versión es una aplicación web; puede usarse desde el navegador
  de un dispositivo móvil, pero no se entrega app nativa.
- **Lectura por hardware de código de barras/RFID**: queda **pospuesto para una versión
  posterior**. En v1 la carga es manual; el código del producto se ingresa a mano.

## Criterios de éxito

> **Nota:** los valores numéricos de abajo son un **objetivo tentativo** (anclas propuestas, no
> metas acordadas). Sirven como referencia inicial y deben ajustarse a lo que sea realista de medir
> en la operación real antes de tomarlos como compromiso.

- El stock mostrado coincide con el registrado tras cada movimiento (0 desfasajes lógicos entre
  movimiento registrado y stock resultante).
- Toda alerta de stock bajo se dispara dentro de **1 minuto** desde que el stock cruza el umbral
  configurado.
- El usuario puede registrar un movimiento de producto (entrada/salida/ajuste) en **≤ 3 clics/pasos**
  desde la pantalla principal.
- Reducción medible de discrepancias de inventario tras 1–2 ciclos de conteo respecto del método
  manual previo (p. ej. **≥ 30 %** menos ítems con diferencia).
- El 100 % de los movimientos queda registrado con fecha, usuario y motivo, permitiendo auditar el
  historial de cualquier producto.
- Toda venta confirmada descuenta el stock de sus ítems y queda registrada como transacción
  (fecha, cajero, ítems, importe, medio de pago) — **0 ventas sin su descuento de stock asociado**.
- El cajero puede completar una venta típica (agregar ítems + cobrar) en **≤ 1 minuto** desde la
  pantalla de venta.

## Casos borde a contemplar

- **Stock negativo**: qué pasa si se intenta registrar una salida mayor al stock disponible (¿se
  bloquea, se permite con advertencia, se registra como faltante?).
- **Venta sin stock suficiente**: se intenta vender más unidades de las disponibles (¿se bloquea la
  venta, se permite y deja stock en negativo, se avisa al cajero?).
- **Pago que no cierra**: importe cobrado distinto al total, o falta indicar el medio de pago al
  confirmar la venta.
- **Venta anulada / devolución**: cómo se revierte el stock y la caja, y qué pasa con el recibo ya
  emitido (marcar la venta como anulada y dejar traza, no un borrado silencioso).
- **Venta interrumpida**: el cajero cierra la pantalla o se corta la conexión a mitad de una venta
  sin confirmar (¿se descuenta stock a medias?, ¿se pierde el carrito?).
- **Ajuste sin motivo**: un ajuste de inventario que no indica causa (merma, robo, error de conteo).
- **Producto duplicado**: alta de un producto con SKU/código ya existente.
- **Proveedor eliminado** con productos aún asociados a él.
- **Alertas repetidas / ruido**: producto que oscila alrededor del umbral y genera alertas
  constantes; necesidad de no saturar al usuario.
- **Registros concurrentes**: dos usuarios modificando el stock del mismo producto casi al mismo
  tiempo.
- **Reporte sobre período sin movimientos**: reporte vacío que debe distinguirse de un error.
- **Datos incompletos**: producto sin stock mínimo definido → ¿puede generar alertas?

## Supuestos y riesgos abiertos

- **Decisión tomada**: la tienda opera con un **único local** en esta versión.
- **Decisión tomada**: incluye **punto de venta**: se procesan ventas y pagos, y cada venta
  descuenta stock automáticamente. Las **entradas, ajustes y reposiciones** se cargan manualmente;
  las **salidas por venta** se generan desde el módulo de ventas.
- **Decisión tomada**: el **pago se registra** (medio + monto), sin integración con pasarelas ni
  terminales de cobro en v1.
- **Decisión tomada**: en v1 la venta emite un **recibo interno** (sin validez fiscal); la
  **factura fiscal/electrónica** se pospone a **etapa 2**. El flujo de venta debe diseñarse para
  poder incorporar la factura fiscal más adelante sin rehacerlo.
- **Riesgo (etapa 2)**: la factura fiscal traerá dependencia externa fuerte (organismo fiscal,
  certificado, punto de venta habilitado, contingencia ante caídas del servicio). Conviene tenerlo
  en cuenta en el modelo de datos de la venta desde v1, aunque no se implemente todavía.
- **Decisión tomada**: el producto es una **aplicación web** (uso desde navegador).
- **Decisión tomada**: sistema **multiusuario con roles** (encargado / personal de depósito), con
  login por cuenta individual.
- **Decisión tomada**: el **escaneo de código de barras se pospone** para una versión posterior; v1
  usa carga manual del código.
- **Decisión tomada**: "tiempo real" significa que el stock se actualiza al confirmar **cada
  movimiento** — compra/entrada, salida, ajuste y restock —, reflejando el resultado de inmediato.
- **Decisión tomada**: en v1 **no hay push en vivo** entre dispositivos; cada usuario ve el stock
  actualizado al **cargar/recargar la pantalla** tras un movimiento. El refresco automático en vivo
  (push) queda como **evolución futura**; el diseño debe dejar la puerta abierta para incorporarlo.
- **Riesgo (activo por la carga manual)**: si registrar movimientos es tedioso, el inventario se
  desactualiza y el sistema pierde valor (mismo problema que las planillas). Mitigación sugerida:
  flujo de carga en ≤ 3 pasos y buenas pantallas de alta rápida.
- **Riesgo**: alertas mal calibradas (demasiadas o muy pocas) erosionan la confianza del usuario.
- **Riesgo (asumido)**: al posponer el escaneo de código de barras, la carga manual puede ser lenta
  y más propensa a error humano — se acepta para v1, a mitigar con un flujo de carga ágil.
- **Decisión tomada**: la matriz de permisos por rol quedó definida (ver sección Usuario objetivo).
  Los ajustes del personal de depósito son **directos y auditados** en v1 (sin aprobación previa).
- **Riesgo**: si los permisos del personal de depósito son demasiado restrictivos, se generan
  cuellos de botella (todo depende del encargado); si son demasiado amplios, se pierde el control
  sobre ajustes/bajas. La matriz busca ese equilibrio y debe validarse con la operación real.
