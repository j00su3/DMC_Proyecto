# Revisión Adversarial — InvenTienda (TECH-DESIGN.md + ADRs)

Documento multi-ronda. Cada ronda se ejecuta en conversación fresca, sin el historial que
generó el TDD ni la lectura del informe de la ronda anterior (para no anclar los hallazgos).

| Ronda | Fecha | Resultado | Estado |
|---|---|---|---|
| [Ronda 2](#ronda-2--2026-08-13-cerrada) | 2026-08-13 | 2 Críticos (C1–C2) · 5 Advertencias (A7–A11) · 5 Sugerencias (S6–S10) | Cerrada (12/12 resueltas el 2026-08-13) |
| [Ronda 1](#ronda-1--2026-07-21-cerrada) | 2026-07-21 | 0 Críticos · 6 Advertencias (A1–A6) · 5 Sugerencias (S1–S5) | Cerrada (11/11 resueltas el 2026-08-13) |

---

# Ronda 2 — 2026-08-13 (cerrada)

**Fecha de revisión:** 2026-08-13
**Fecha de resolución:** 2026-08-13
**Alcance revisado:** `TECH-DESIGN.md`, ADRs 0001–0009 (incluye los cambios aplicados al
resolver la Ronda 1), cruzado contra `PRD.md` y `design.md`.
**Condición:** conversación fresca; el informe de la Ronda 1 **no** se leyó antes de producir
estos hallazgos (se leyó después, solo para integrar ambas rondas en este archivo).
**Dónde viven las resoluciones:** en **`TECH-DESIGNv2.md`** (nuevo, supersede a `TECH-DESIGN.md`
v1, que se conservó intacto como referencia) y en los ADRs actualizados 0002, 0005, 0007, 0008
y 0009 — ver "Resolución" en cada hallazgo.

## Veredicto general

El diseño está maduro: los 9 ADRs tienen alternativas reales y trade-offs honestos, y la
mayoría resiste el escrutinio. Pero se encontraron **2 hallazgos críticos** que contradicen
requisitos declarados si se implementa tal como está escrito — uno de ellos introducido,
irónicamente, por la resolución de la Ronda 1 (A2) — más 5 advertencias reales.

**Resumen:** 2 Críticos (C1–C2) · 5 Advertencias (A7–A11) · 5 Sugerencias (S6–S10).

**Estado de resolución:** los 12 hallazgos fueron resueltos el 2026-08-13 — ver "Resolución" en
cada uno. La única decisión que requirió elección del usuario (no derivable técnicamente) fue el
stack backend de S8.

---

## Críticos

### C1. La política de error del evaluador de alertas es inalcanzable tal como está escrita

**Afecta a:** ADR-0008, ADR-0001, criterio de aceptación "Un fallo del evaluador no revierte
el movimiento". *(Emerge de la resolución de A2 de la Ronda 1: la política elegida es
correcta, pero el mecanismo descrito no puede cumplirla.)*

El diseño afirma dos cosas a la vez: (a) el evaluador corre **dentro de la transacción** del
movimiento, y (b) "un fallo del evaluador **no** revierte el movimiento/venta — se captura,
se registra y la transacción confirma igual". En Postgres esas dos afirmaciones son
incompatibles con un simple try/catch: si cualquier sentencia SQL del evaluador falla (el
INSERT de la alerta viola una constraint, la consulta del promedio de 30 días tiene un
error), **la transacción entera queda abortada** (estado `25P02`) y el COMMIT posterior hace
rollback — incluido el movimiento y la venta. El catch a nivel aplicación solo salva errores
puros de JS, no errores SQL, y el evaluador ejecuta SQL (lee historial, inserta alertas).

El peor caso resultante es exactamente el que el ADR-0008 declara inaceptable: "una venta que
no se puede cobrar por un bug del evaluador". El criterio de aceptación fallaría en el test.

**Solución barata, pero hay que decidirla:** envolver el evaluador en un `SAVEPOINT` (y
`ROLLBACK TO SAVEPOINT` en el catch), o moverlo a inmediatamente-después-del-commit (el
objetivo de "< 1 minuto" sigue cumpliéndose). Ningún documento menciona ninguna de las dos.

**Resolución (2026-08-13):** se eligió el `SAVEPOINT` — antes de invocar el evaluador se emite
`SAVEPOINT alertas`; ante cualquier fallo (SQL o de aplicación) se ejecuta `ROLLBACK TO
SAVEPOINT alertas`, se loguea y la transacción del movimiento confirma igual. La alternativa
post-commit se descartó porque el savepoint cuesta una línea y conserva la atomicidad
alerta+movimiento cuando el evaluador funciona. ADR-0008 ahora explica por qué el try/catch solo
no alcanza (`25P02`), y el criterio de aceptación exige un test que inyecte un error SQL en el
evaluador y verifique que la venta confirma. Ver `TECH-DESIGNv2.md` § Evaluación de alertas.

### C2. El stock inicial y la edición de `stock_actual` pueden saltarse el ledger

**Afecta a:** ADR-0003, modelo de datos (`Producto`), PRD (alcance de Gestión de productos).

El invariante central del ADR-0003 es "no existe forma de cambiar el stock sin dejar su
rastro auditable". Pero el PRD lista `stock actual` como **dato básico de alta y edición de
productos**, y ni el TDD ni ningún ADR definen qué pasa con ese campo en esos formularios:

- **Alta:** un producto nuevo con stock inicial 50 — ¿genera un movimiento (¿de qué tipo?
  ¿`entrada`? ¿`ajuste` con motivo "stock inicial"?) o nace con `stock_actual = 50` y un
  ledger vacío que no suma 50? La verificación periódica de consistencia (stock vs suma del
  ledger) que el propio TDD propone **fallaría desde el día uno** para todo producto con
  stock inicial.
- **Edición:** si el formulario de edición permite tocar `stock_actual` (el PRD sugiere que
  sí), es un canal de modificación de stock sin ledger, sin motivo y accesible al rol
  depósito — rompe "el 100 % de los movimientos queda registrado" y reabre el riesgo de
  enmascarar faltantes que la matriz de permisos intenta cerrar.

Falta una decisión explícita: el alta genera un movimiento de stock inicial, y la edición de
producto **excluye** `stock_actual` (todo cambio de stock pasa por movimientos).

**Resolución (2026-08-13):** exactamente eso — el alta con stock inicial > 0 crea, en la misma
transacción, un Movimiento tipo `ajuste` con motivo fijo "stock inicial (alta de producto)" y
`es_discrepancia = false` (stock inicial 0 no genera movimiento); el schema Zod de edición **no
acepta** `stock_actual` y el backend rechaza cualquier payload que lo incluya. El invariante del
ledger queda sin excepciones y la verificación de consistencia da 0 desde el alta. Ver
`TECH-DESIGNv2.md` § Producto + criterios (C2) de Gestión de productos.

---

## Advertencias

### A7. `stock_minimo` editable por depósito contradice "Configurar umbrales ❌"

**Afecta a:** ADR-0007, matriz de permisos del PRD.

La matriz del PRD tiene dos filas en tensión que el TDD no resuelve: "Alta/edición de
productos → 🔒 permitido a depósito" y "Configurar umbrales de stock/alertas → ❌ depósito".
Pero `stock_minimo` — que es el umbral de alertas por producto — es un campo del formulario
de producto según el PRD. Si depósito puede editar productos, ¿puede editar `stock_minimo`?
El RBAC del ADR-0007 es por endpoint, y aquí el permiso se decide **por campo dentro del
mismo endpoint** — un caso que el middleware descrito no cubre y que nadie asignó a ninguna
capa.

**Resolución (2026-08-13):** el permiso por campo se asignó a la **capa de servicio de
producto**: si el actor es rol depósito y el payload setea o modifica `stock_minimo` (en alta o
edición), la operación responde 403 con código `campo_reservado_encargado`; la SPA muestra el
campo con 🔒. ADR-0007 lo documenta como el **único** permiso por campo del sistema (tercera
capa: endpoint → fila → campo), con la regla de generalizarlo si aparece un segundo caso. Se
agregó el criterio de aceptación (A7) en RBAC.

### A8. No se puede anular una venta de un producto dado de baja

**Afecta a:** ADR-0005, TDD (baja lógica de producto + criterios de Anulación).

El UPDATE condicional exige `activo = true` para **todo** movimiento, y el TDD dice que un
producto inactivo "rechaza cualquier movimiento nuevo". Pero la anulación de venta crea
movimientos de reversión. Secuencia: se vende el producto → el encargado lo da de baja → hay
que anular la venta → el movimiento de reversión es rechazado por `activo = true` → rollback
de toda la anulación. El encargado queda sin poder anular, o debe reactivar el producto,
anular y volver a darlo de baja (tres operaciones sin traza que explique por qué). Falta
decidir si los movimientos de reversión están exentos de la condición `activo`.

**Resolución (2026-08-13):** la reversión pasó a ser un tipo de movimiento propio —
**`anulacion`** (positivo, `venta_id` obligatoria, mapea al chip ANULACIÓN del design.md) —
**exento** de la condición `activo = true` (y de `stock >= :n`, porque suma): la reversión de
una operación pasada no es un movimiento nuevo de negocio. ADR-0005 documenta la excepción y su
trade-off (un producto inactivo puede quedar con stock > 0; ese stock no se mueve salvo
reactivación). Criterio de aceptación (A8) agregado en Anulación.

### A9. "Ajuste marcado como discrepancia" no tiene representación en el modelo de datos

**Afecta a:** modelo de datos (`Movimiento`, `Alerta`), criterio de aceptación de Alertas.

El criterio de aceptación dice "un ajuste **marcado como** discrepancia genera una alerta",
y existen `Alerta.tipo = discrepancia` y un reporte de discrepancias. Pero `Movimiento` no
tiene ningún campo que marque un ajuste como discrepancia (tiene `motivo` libre, nada más).
¿Todo ajuste es una discrepancia (entonces "marcado como" sobra y cada corrección de conteo
dispara una alerta — ruido)? ¿O hay un flag/categoría de motivo que nadie modeló? El
criterio, tal cual, no es implementable ni testeable.

**Resolución (2026-08-13):** se agregó la columna **`Movimiento.es_discrepancia`** (`boolean`,
default `false`, con `CHECK` que la restringe a `tipo = ajuste`): al registrar un ajuste, el
usuario indica si es una diferencia de inventario (conteo físico ≠ sistema) o una corrección
operativa normal. Solo los ajustes con el flag generan alerta de discrepancia y alimentan el
reporte de discrepancias — "marcado como" pasó de frase suelta a columna. Criterios (A9)
agregados en Movimientos y Alertas de `TECH-DESIGNv2.md`.

### A10. El ciclo de vida de la alerta y la regla anti-ruido están nombrados pero no definidos

**Afecta a:** ADR-0008, entidad `Alerta`, criterio "no genera alertas repetidas".

`Alerta.estado` tiene `activa | vista | resuelta` y "datos anti-ruido", pero ningún documento
define: quién o qué resuelve una alerta (¿manual? ¿automática cuando el stock repone?), qué
pasa con la alerta de quiebre cuando entra mercadería, si anular una venta (que sube stock)
resuelve la alerta que esa venta disparó, ni cuál es la regla concreta de de-duplicación
(¿no re-alertar mientras exista una `activa` del mismo producto+tipo? ¿y cuando pasa a
`vista`?). El criterio "un producto que oscila alrededor del umbral no genera alertas
repetidas" no se puede testear sin esa regla, y el TDD ya identifica la calibración de
alertas como riesgo de confianza — este es el pedazo de diseño que ese riesgo necesitaba y
no tiene.

**Resolución (2026-08-13):** el ciclo de vida quedó completamente definido en ADR-0008 y
`TECH-DESIGNv2.md`: (1) **creación por cruce** — `stock_bajo`/`quiebre` se crean solo cuando el
movimiento cruza el umbral hacia abajo, no en cada movimiento bajo el umbral (el ruido de
oscilación se elimina en origen); (2) **de-duplicación** — no se crea alerta si existe una del
mismo producto+tipo en `activa` o `vista` (`vista` = leída, sigue bloqueando; solo `resuelta`
habilita re-disparo); (3) **resolución automática** — `stock_bajo` cuando el stock supera el
mínimo y `quiebre` cuando vuelve a ser > 0, por el propio evaluador, incluida la reposición por
anulación de venta (`resuelta_por` nulo); (4) **resolución manual** — `discrepancia` y
`sugerencia_reposicion` las resuelve el encargado. `Alerta` ganó `resuelta_en`/`resuelta_por`.

### A11. Los criterios de éxito del PRD son inmedibles bajo el despliegue elegido

**Afecta a:** ADR-0009, criterios de éxito del PRD, riesgos abiertos del TDD.

El ADR-0009 es honesto sobre sus condiciones de revisión, pero éstas son **técnicas** (acceso
LAN, hosting). La consecuencia de segundo orden que no menciona: casi todos los criterios de
éxito del PRD (≥ 30 % menos discrepancias en 1–2 ciclos de conteo, validar la matriz de
permisos "con la operación real", calibrar alertas "con datos reales") y varias mitigaciones
de riesgos del TDD **requieren operación real con usuarios reales** — exactamente lo que
`localhost`-solo excluye por tiempo indefinido. Se construye un sistema multiusuario con RBAC
para usuarios que no pueden acceder a él. No es un error de diseño, pero el ADR debería atar
la revisión también a un hito de producto ("antes del primer ciclo de conteo real"), no solo
a eventos de infraestructura.

**Resolución (2026-08-13):** ADR-0009 sumó una tercera condición de revisión, de **producto**:
antes de iniciar el primer ciclo de conteo real de inventario (el hito que dispara la medición
de los criterios de éxito), el ADR debe revisarse aunque no haya ocurrido ningún evento de
infraestructura — si el sistema sigue siendo `localhost`-solo en ese momento, hay que decidir
despliegue o redefinir los criterios. El riesgo quedó también registrado en la sección de
riesgos de `TECH-DESIGNv2.md`.

---

## Sugerencias

### S6. `numero_correlativo` con huecos

**Afecta a:** modelo de datos (`Venta`), puerta abierta a etapa 2 fiscal.

Si se implementa con una secuencia de Postgres, cada venta que hace rollback (stock
insuficiente, error) consume un número — quedan huecos, y en una traza de auditoría un número
faltante parece una venta borrada. Para v1 quizás tolerable, pero la factura fiscal de etapa
2 exigirá correlatividad estricta; conviene decidir ahora (contador en tabla dentro de la
transacción vs secuencia con huecos documentados).

**Resolución (2026-08-13):** se desacoplaron las dos numeraciones. `numero_correlativo` (v1)
usa secuencia de Postgres con **huecos aceptados y documentados** (un hueco = venta que no
llegó a confirmarse, no una venta borrada — dicho explícitamente para el auditor interno); la
correlatividad estricta fiscal de etapa 2 usará `numero_fiscal` con **contador propio en tabla,
incrementado dentro de la transacción** de emisión. Criterio (S6) agregado en POS.

### S7. Heurística de reposición ambigua

**Afecta a:** ADR-0008.

"Stock < N × promedio de salidas/ventas de 30 días" no define la unidad del promedio
(¿promedio *diario*? ¿total del período?) ni qué pasa con productos con menos de 30 días de
historia o sin ventas (promedio 0 → nunca sugiere). Tal como está, dos implementadores
producirían dos reglas distintas.

**Resolución (2026-08-13):** ADR-0008 fijó la definición operativa única: `promedio_diario` =
unidades salidas (`venta` + `salida`) de los últimos 30 días ÷ 30 (**unidades/día**);
`cobertura_dias` = `stock_actual` ÷ `promedio_diario`; se sugiere cuando `cobertura_dias < 14`
(N fijo, configurable a futuro). Productos con menos de 7 días de historia no se evalúan (entre
7 y 30, el promedio usa los días disponibles); `promedio_diario = 0` **nunca** sugiere — los
sin rotación quedan cubiertos por `stock_bajo`/`quiebre`. Criterio (S7) agregado en Alertas.

### S8. Framework y ORM diferidos, pero el ADR-0004 los condiciona

**Afecta a:** ADR-0002, ADR-0004.

El pipeline code-first Zod → OpenAPI → tipos TS se integra de forma muy distinta en Express,
Fastify y NestJS. La elección "a definir en implementación" no es libre — está restringida
por una decisión ya aceptada; conviene fijarla antes de escribir código.

**Resolución (2026-08-13, decisión del usuario):** **Fastify + Drizzle**. Fastify porque
`fastify-type-provider-zod` valida en runtime y genera el OpenAPI de los mismos schemas Zod (el
pipeline del ADR-0004 sale nativo); Drizzle porque es SQL-first y deja escribir tal cual el
UPDATE condicional del ADR-0005 y los savepoints del ADR-0008. ADR-0002 quedó actualizado con
las alternativas descartadas (Express+Prisma, Hono+Drizzle, NestJS+Prisma) y sus razones.

### S9. La mitad del caso borde "venta interrumpida" quedó sin responder

**Afecta a:** TDD (criterios de POS), área de decisión ausente (estado del frontend).

El PRD pregunta explícitamente "¿se descuenta stock a medias?, **¿se pierde el carrito?**".
El TDD responde lo primero (no se descuenta) y calla lo segundo. Relacionado: no hay ninguna
decisión de manejo de estado del frontend (cache/refetch, polling, dónde vive el carrito) —
el único ADR de "estado" (0005) es de concurrencia en BD.

**Resolución (2026-08-13):** el carrito **no se pierde**: vive en la SPA y se persiste en
`localStorage` por dispositivo (clave asociada al usuario) — una recarga, cierre de pestaña o
corte de conexión lo restauran al volver al POS; se limpia al confirmar la venta o vaciarlo
explícitamente, y no se comparte entre dispositivos (coherente con "sin push" en v1). El estado
de servidor se maneja con **TanStack Query** (fetch/cache/refetch + el polling de alertas).
Documentado en `TECH-DESIGNv2.md` § Arquitectura y ADR-0002; criterio (S9) agregado en POS.

### S10. Dos detalles gratis de fijar ahora

**Afecta a:** modelo de datos, ADR-0007.

Tipo `NUMERIC` (nunca float) para `precio`/`total`/`monto`, y el atributo `SameSite` de la
cookie de sesión — la protección CSRF está listada como riesgo pero `SameSite=Lax/Strict`
cuesta una línea y cierra la mayor parte.

**Resolución (2026-08-13):** todos los campos monetarios (`precio`, `total`, `monto`, `vuelto`,
`precio_unitario`, `subtotal`) quedaron como **`NUMERIC(12,2)`** en el modelo de datos, y la
cookie de sesión lleva **`SameSite=Lax`** desde v1 (ADR-0007; `Secure` sigue condicionado al
despliegue, ver ADR-0009).

---

## Lo que resistió el escrutinio (Ronda 2)

- **ADR-0006 (nunca negativo):** decisión de negocio con alternativas genuinas (permitir con
  advertencia, regla mixta) y un trade-off honesto sobre la fricción en caja. No se encontró
  un caso que la regla + la vía auditada de corrección no cubran.
- **ADR-0005 (update atómico condicional):** el orden determinístico por `producto_id` para
  evitar deadlocks es correcto, y la alternativa pesimista/optimista está bien descartada
  para esta escala. Su único hueco real es el de la anulación (A8).
- **ADR-0004 (REST/OpenAPI):** el rechazo de tRPC por la integración fiscal no-TS de etapa 2
  es un argumento concreto, no boilerplate; el sobre de errores y la paginación fijados de
  antemano son madurez poco común en un TDD.
- **ADR-0001 y ADR-0002:** proporcionales al proyecto de una persona; el descarte del worker
  de alertas y de Python están bien fundados y con costos reconocidos.
- Ningún ADR contradice el "No alcance" del PRD, y la trazabilidad design.md → modelo de
  datos está bien cubierta (chips, KPIs, POS, vuelto, matriz de permisos).

## Prioridad recomendada antes de escribir código (Ronda 2)

1. **C1** — savepoint o evaluación post-commit (contradice un criterio de aceptación).
2. **C2** — stock inicial como movimiento + excluir `stock_actual` de la edición (contradice
   el invariante de auditabilidad).
3. **A7/A8/A9** — tres decisiones chicas de modelo/permisos que bloquean la implementación
   de flujos ya especificados.

Los dos críticos tienen arreglos chicos — el costo está en decidirlos, no en implementarlos.

## Estado final (Ronda 2)

**2/2 Críticos, 5/5 Advertencias y 5/5 Sugerencias resueltos**, todos el 2026-08-13. Las
resoluciones se materializaron en **`TECH-DESIGNv2.md`** (nuevo documento que supersede a
`TECH-DESIGN.md` v1, conservado intacto como referencia histórica) y en los ADRs actualizados:
`ADR-0002` (stack fijado — S8/S9), `ADR-0005` (exención de `anulacion` — A8), `ADR-0007`
(permiso por campo + `SameSite=Lax` — A7/S10), `ADR-0008` (SAVEPOINT, heurística de reposición
y ciclo de vida de alertas — C1/S7/A10) y `ADR-0009` (condición de revisión por hito de
producto — A11). La única decisión que requirió elección del usuario fue el stack backend (S8:
Fastify + Drizzle); el resto se derivó de los requisitos ya aceptados.

---

# Ronda 1 — 2026-07-21 (cerrada)

**Fecha de revisión:** 2026-07-21
**Fecha de resolución:** 2026-08-13
**Alcance revisado:** `TECH-DESIGN.md`, ADRs 0001–0008, cruzado contra `PRD.md` y `design.md`.
**Condición:** revisión ejecutada en conversación fresca (sin historial de generación del TDD).

## Veredicto general

No se encontró ningún hallazgo que califique como **Crítico** (el diseño no contradice el
alcance del PRD ni contiene una decisión que lo haga fallar con certeza). Se encontraron
**seis Advertencias** reales — en su mayoría consecuencias de segundo orden que los propios
ADRs no mencionan, o casos que el PRD nombra explícitamente y el TDD no cubre — y **cinco
Sugerencias**.

**Resumen:** 0 Críticos · 6 Advertencias (A1–A6) · 5 Sugerencias (S1–S5).

**Estado de resolución:** las 6 Advertencias fueron atendidas el 2026-08-13 — ver "Resolución"
en cada una. Las Sugerencias (S1–S5) también quedaron resueltas el 2026-08-13.

---

## Advertencias

### A1. "Alerta en < 1 minuto por construcción" confunde *generar* con *notificar*

**Afecta a:** ADR-0001, ADR-0008, criterios de aceptación de Alertas.

El TDD repite que evaluar alertas dentro de la transacción "cumple el objetivo de < 1 minuto
por construcción". Eso es cierto solo para la **creación del registro** de alerta. El PRD
habla de "notificaciones" y de que "el encargado **reciba** alertas antes de que un problema
se convierta en pérdida" — y la misma v1 decidió **no tener push en vivo**: el encargado ve
la alerta recién cuando recarga la pantalla, lo que puede ser horas después.

El TDD no toma ninguna decisión sobre el mecanismo de entrega (¿badge con polling? ¿nada?).
No es contradicción formal (el PRD dice "se dispara"), pero el argumento "cumplido por
construcción" es una sobreventa: el valor del criterio (enterarse a tiempo) no está
garantizado por nada del diseño. Falta al menos una decisión mínima de entrega (p. ej.
polling del contador de alertas en la SPA).

**Resolución (2026-08-13):** se agregó un criterio de aceptación explícito en Alertas del TDD
— mientras haya sesión activa, la SPA hace polling periódico del conteo de alertas activas
para reflejar alertas nuevas sin recargar toda la pantalla; el push en vivo real queda
confirmado como puerta de etapa 2, no como algo ya resuelto.

### A2. Un fallo del evaluador de alertas aborta la venta

**Afecta a:** ADR-0008.

Trade-off que el ADR-0008 no menciona: al ejecutar `EvaluadorDeAlertas` **dentro de la
transacción** del movimiento, una excepción o bug en el código de alertas (lógica accesoria)
hace rollback de la venta o del movimiento (lógica esencial). El ADR discute el costo de un
`EvaluadorML` lento, pero no la política de errores del evaluador de v1: ¿se captura y
degrada (el movimiento confirma, la alerta se pierde) o aborta todo?

Esa decisión cambia el contrato de la interfaz y hoy no está tomada. Es exactamente el tipo
de acoplamiento que convierte un bug menor en "no se puede vender".

**Resolución (2026-08-13):** ADR-0008 fija la política — un error del evaluador se captura,
se loguea y **no** revierte el movimiento/venta; la alerta es valor agregado, no puede ser
el punto de falla de una operación esencial. Se documentó como trade-off explícito (una
alerta con bug puede fallar en silencio) y se agregó un criterio de aceptación
correspondiente en el TDD.

> **Nota (Ronda 2):** el hallazgo C1 de la Ronda 2 muestra que esta resolución fija la
> política correcta pero con un mecanismo (try/catch dentro de la transacción) que Postgres
> no puede honrar ante errores SQL — requiere `SAVEPOINT` o evaluación post-commit.

### A3. Riesgo de deadlock en ventas multi-ítem concurrentes

**Afecta a:** ADR-0005.

El ADR-0005 resuelve bien el caso "dos usuarios, un producto", pero no menciona el caso
"dos ventas, varios productos": dos transacciones que aplican updates condicionales sobre
productos superpuestos **en distinto orden** pueden deadlockearse en Postgres (una aborta
con error `40P01`, que le llegaría al cajero como fallo confuso).

La mitigación es trivial si se decide ahora — ordenar los ítems por `producto_id` antes de
aplicar los updates — pero el ADR no la registra y los "tests de concurrencia" del riesgo
abierto no la nombran.

Notas menores asociadas:

- Cuando el UPDATE afecta 0 filas, el mensaje "stock insuficiente: hay N" exige una lectura
  aparte de N que puede estar ya desactualizada.
- 0 filas afectadas tampoco distingue "sin stock" de "producto inexistente/inactivo".

**Resolución (2026-08-13):** ADR-0005 ahora especifica que los ítems de una venta se procesan
en **orden determinístico por `producto_id`**, evitando el deadlock entre transacciones
concurrentes con productos superpuestos (documentado como trade-off: evita el deadlock, no
elimina la espera — aceptable con la concurrencia baja de un local único). También se fijó
que la lectura de N para el mensaje de error se hace **dentro de la misma transacción**. La
distinción "sin stock" vs. "producto inexistente/inactivo" queda como detalle de
implementación, no se resolvió a nivel de ADR.

### A4. El PRD pide revertir "el stock **y la caja**" al anular; el TDD solo revierte stock

**Afecta a:** modelo de datos (`Venta`, `Pago`), criterios de Anulación/devolución.

El caso borde del PRD dice textualmente: "Venta anulada / devolución: cómo se revierte el
stock **y la caja**". Los criterios del TDD cubren reversión de stock, marca de anulada y
traza del recibo — nada sobre el `Pago`. La entidad `Pago` no tiene estado ni reversión: una
venta anulada conserva un pago "vivo" sin marca de devuelto.

Relacionado: el PRD dice "anular / **devolver**", y el modelo solo soporta anulación
**total** (`estado: confirmada | anulada`). Una devolución parcial (devolver 1 de 3 ítems,
frecuentísima en retail) no tiene representación posible, y agregarla después toca `Venta`,
`ItemVenta`, `Pago` y el ledger.

Merece al menos una decisión explícita: "v1 = solo anulación total, devolución parcial fuera
de alcance". Hoy el TDD lo resuelve por omisión.

**Resolución (2026-08-13):** se agregó `Pago.estado` (`registrado` | `revertido`) al modelo
de datos; al anular una venta, su pago pasa a `revertido`, cubriendo "revertir el stock y la
caja". Se dejó explícito que v1 solo soporta anulación **total** de la venta — la devolución
parcial de ítems queda fuera de alcance, no resuelta por omisión sino declarada como
decisión. Se agregaron ambos puntos como criterios de aceptación en Anulación/devolución.

### A5. No existe ninguna decisión de despliegue, backups ni HTTPS

**Afecta a:** área de decisión ausente (ningún ADR la cubre).

Ningún ADR dice dónde corre el sistema (¿servidor en la tienda? ¿nube?), cómo se respalda
la base, ni que la app va sobre HTTPS. No es un detalle de implementación:

- La propuesta de valor entera es ser "la fuente única y actualizada del inventario" — sin
  decisión de backup, un disco muerto borra el inventario y las ventas de la tienda.
- La cookie de sesión del ADR-0007 necesita `Secure` + `SameSite`, que presuponen HTTPS/TLS,
  y la estrategia CSRF depende de eso.
- Local vs. nube cambia latencia, acceso desde varios dispositivos y contingencia ante corte
  de internet en plena caja.

Es el hueco más grande de cobertura del set de ADRs.

**Resolución (2026-08-13):** se creó **ADR-0009 — Despliegue local**. Decisión tomada para
v1: Postgres + backend corren local en la máquina del desarrollador (el hosting queda como
decisión pendiente, sin fecha, es un proyecto propio). Se fijaron dos mitigaciones concretas
aun sin resolver hosting: backup programado (`pg_dump`) a una ubicación **distinta del disco
principal**, y una **condición de revisión explícita** — antes de acceder desde otro
dispositivo en LAN o de subir a un hosting, hay que revisar HTTPS, la cookie `Secure`
(ADR-0007) y la redundancia del backup. El riesgo no desaparece, pero deja de estar sin
dueño ni disparador de revisión.

### A6. El RBAC por endpoint no alcanza para "sus propios movimientos"

**Afecta a:** ADR-0007, criterios de Reportes.

La matriz del PRD da al depósito reportes operativos incluyendo "**sus propios**
movimientos" (y le niega discrepancias globales). Eso es autorización a **nivel de fila**
(filtrar datos por usuario), no a nivel de endpoint, que es lo único que el ADR-0007 decide
("un middleware valida en cada endpoint el rol"). El mecanismo elegido no implementa por sí
solo ese requisito; hay que decidir dónde vive el filtrado por dueño.

Además, dos huecos concretos de la auth propia que ni el ADR ni el checklist genérico de
riesgos nombran:

- **Rate-limit / lockout del login**: fuerza bruta contra hashes propios.
- **Bootstrap del primer encargado**: ¿quién crea al usuario que crea usuarios? ¿Y si el
  único encargado olvida su contraseña, sin flujo de reset en v1?

**Resolución (2026-08-13):** ADR-0007 aclara que el middleware de RBAC cubre autorización
**por endpoint**, y que el filtrado por dueño ("mis movimientos") es responsabilidad de la
capa de servicio/consulta (`WHERE usuario_id = :actor` explícito). Se agregaron también:
rate-limit/lockout de login (~5 intentos → bloqueo temporal), bootstrap del primer encargado
fuera de la API (seed/script al desplegar, ligado a ADR-0009), y un procedimiento
administrativo manual como vía de rescate si el único encargado pierde su contraseña (el
reset por email sigue fuera de alcance de v1).

---

## Sugerencias

### S1. Deriva silenciosa entre el OpenAPI y la implementación

**Afecta a:** ADR-0004.

El "único origen de verdad" del contrato solo se sostiene si el servidor se valida contra la
especificación. No está decidido spec-first vs. code-first ni si hay validación en runtime
contra el OpenAPI; sin eso, el spec y la implementación derivan en silencio. Tampoco hay
decisión sobre el formato de error de la API (los criterios citan 401/403 y mensajes como
"stock insuficiente: hay N", pero ninguna forma de respuesta de error), ni sobre paginación,
que el `design.md` sí muestra en las tablas.

**Resolución (2026-08-13):** ADR-0004 pasó a **code-first**: los esquemas se definen una vez
en TypeScript (Zod) y de ahí se derivan tanto el OpenAPI como los tipos de la SPA — la deriva
silenciosa queda estructuralmente cerrada porque el spec ya no es un documento paralelo a
mantener a mano. Se fijaron además el sobre de error estándar
(`{ error: { code, message, details? } }`) y la convención de paginación
(`?page&pageSize` → `{ data, page, pageSize, total }`) para todos los endpoints de listado.

### S2. Redundancia signo vs. tipo en `Movimiento`

**Afecta a:** modelo de datos (ADR-0003).

`Movimiento.cantidad` con signo + `tipo` es información redundante que puede contradecirse
(una `entrada` con −5). Un CHECK por tipo lo cierra barato. Mismo espíritu para
`stock_resultante`: útil para auditoría, pero debe calcularse dentro de la misma transacción
o miente.

**Resolución (2026-08-13):** ADR-0003 agregó un `CHECK` en `movimientos` que ata el signo de
`cantidad` al `tipo` (`entrada` > 0; `salida`/`venta` < 0; `ajuste` libre), y dejó explícito
que `stock_resultante` se calcula **dentro de la misma transacción** que el update de stock,
inmediatamente después de aplicarlo.

### S3. `sugerencia_reposicion` existe en el modelo pero ninguna regla de v1 la produce

**Afecta a:** ADR-0008, entidad `Alerta`.

El tipo de alerta `sugerencia_reposicion` existe en el modelo, pero v1 no define ninguna
regla que la genere ("según consumo histórico" es un cálculo agregado que no encaja en la
evaluación in-transaction liviana que el ADR asume). O se define la regla v1, o se declara
que ese tipo queda vacío hasta etapa 2.

**Corrección al releer el PRD (2026-08-13):** el hallazgo original ofrecía "declarar el tipo
vacío hasta etapa 2" como salida válida — es incorrecto. El PRD lista explícitamente
"(best-effort) sugerencias de reposición según consumo histórico" dentro del **Alcance de
v1** (no en "No alcance"), a diferencia del resto del motor de ML. Dejarlo vacío habría sido
un hueco de cobertura real, no una simplificación aceptable.

**Resolución (2026-08-13):** ADR-0008 define una heurística v1 dentro de `ReglasUmbral` (no
ML): si `stock_actual` cae por debajo de N veces el promedio de salidas/ventas de los
últimos 30 días del producto, se genera `sugerencia_reposicion`. Documentado como trade-off:
esta regla, a diferencia de las demás de `ReglasUmbral`, necesita leer movimientos
históricos en cada evaluación, no solo el movimiento actual.

> **Nota (Ronda 2):** la heurística resuelta quedó ambigua en sus unidades — ver S7.

### S4. Comportamiento del producto inactivo sin especificar

**Afecta a:** modelo de datos, ADR-0005.

La baja lógica está bien resuelta para el historial, pero nadie especifica qué operaciones
admite un producto con `activo=false`: ¿se puede vender? ¿recibir entradas? El UPDATE
condicional del ADR-0005 no incluye `activo` en su condición. Hoy la respuesta queda librada
a la implementación.

**Resolución (2026-08-13):** ADR-0005 agregó `AND activo = true` a la condición del UPDATE:
un producto inactivo bloquea todo movimiento nuevo (venta, entrada, salida, ajuste) a nivel
de base de datos, no solo por una validación de aplicación que se pudiera olvidar en un
endpoint nuevo. Reactivarlo queda reservado al encargado, igual que la baja.

> **Nota (Ronda 2):** esta resolución introdujo el caso no cubierto de la anulación de una
> venta cuyo producto fue dado de baja después — ver A8.

### S5. `Recibo` como entidad 1:1 duplica datos

**Afecta a:** modelo de datos.

`Recibo` duplica datos que ya viven en `Venta`/`ItemVenta`/`Pago`. Salvo que se quiera
congelar una instantánea inmutable (argumento válido — conviene decirlo explícitamente),
podría ser una vista/documento derivado y no una tabla.

**Resolución (2026-08-13):** se eliminó `Recibo` como entidad del modelo de datos. Pasa a
ser un documento **derivado on-demand** de `Venta`+`ItemVenta`+`Pago` al imprimir/descargar
— seguro porque una Venta confirmada es inmutable (solo cambia `estado` al anular, nunca sus
ítems/importes). El estado "anulado" del recibo se hereda de `Venta.estado`, sin campo
propio.

---

## Lo que sí resistió el escrutinio (Ronda 1)

- **ADR-0003** (stock guardado + ledger) y **ADR-0006** (nunca negativo) resistieron bien el
  ataque: alternativas genuinamente viables (event-sourcing liviano, SQLite, regla mixta),
  trade-offs reales admitidos en el propio ADR, y el riesgo residual honestamente registrado
  en la sección de riesgos.
- **ADR-0002** es proporcional al equipo de una persona; su única debilidad es diferir
  framework y ORM, aceptable a este nivel.
- La trazabilidad Design.md → modelo de datos está inusualmente bien hecha (chips, vuelto,
  avatares por rol: todo tiene columna que lo respalda).
- Ningún ADR es boilerplate ni ofrece alternativas falsas.

## Estado final (Ronda 1)

**6/6 Advertencias resueltas** (A1–A6) y **5/5 Sugerencias resueltas** (S1–S5), todas el
2026-08-13. Ningún hallazgo del informe original quedó sin atender. La única corrección
sobre el informe original: al resolver **S3**, se detectó que la propia sugerencia inicial
("declarar el tipo vacío hasta etapa 2") contradecía el PRD — quedó documentado en la
resolución de S3 y corregido a una heurística v1 real.

Cambios aplicados en: `ADR-0003`, `ADR-0004`, `ADR-0005`, `ADR-0007`, `ADR-0008`, `ADR-0009`
(nuevo) y `TECH-DESIGN.md` (modelo de datos y criterios de aceptación).
