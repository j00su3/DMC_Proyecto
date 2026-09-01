# Deploy Plan — InvenTienda

Fecha: 2026-08-29
Estado: DISEÑADO — documenta el sistema tal como existe hoy y marca sus huecos. **No se ejecutó
ninguna acción sobre infraestructura, secretos ni datos.** Todo lo que aparece bajo "Autorizaciones
pendientes" sigue pendiente de aprobación explícita del propietario.

> Este documento describe lo que el repositorio **realmente hace hoy**, con la evidencia citada
> archivo por línea. Donde una etapa del sistema de despliegue no existe o se resuelve de forma
> informal, se dice así de manera explícita y se indica qué haría falta para cerrarla. Un hueco
> documentado con honestidad vale más que un proceso inventado.

---

## Resumen del proyecto

Monorepo pnpm (`pnpm@11.21.0`, Node `>=22 <23` — `package.json:5-8`) con dos aplicaciones
desplegables y una base de datos gestionada:

| Superficie | Qué es | Dónde vive | Evidencia |
| --- | --- | --- | --- |
| `apps/web` | SPA React 19 + Vite 8, TanStack Query/Router | Vercel — `https://dmc-proyecto.vercel.app` | `vercel.json:1-14` |
| `apps/api` | API Fastify 5 + Drizzle ORM, proceso Node persistente | Render (plan `free`, región `oregon`) — `https://inventienda-api.onrender.com` | `render.yaml:1-10` |
| Base de datos | PostgreSQL gestionado | Neon (tier gratuito) | `docs/adrs/0010-despliegue-tiers-gratuitos.md:17-19` |
| Postgres local | `postgres:16-alpine` en contenedor | Docker Compose, solo desarrollo | `docker-compose.yml:1-20` |

La decisión de plataforma está registrada y es reciente: **ADR-0010**
(`docs/adrs/0010-despliegue-tiers-gratuitos.md`), aceptado el 2026-08-24, reemplaza a ADR-0009
(despliegue local). El costo mensual objetivo es cero, y todos los trade-offs del plan gratuito son
consecuencias aceptadas y escritas en ese ADR, no accidentes.

La pieza de arquitectura que sostiene todo lo demás: **`vercel.json:5-9` reescribe `/api/:path*`
hacia el servicio de Render**, de modo que el navegador solo ve un origen (`dmc-proyecto.vercel.app`).
Por eso la SPA construye sus llamadas con `fetch()` sobre una ruta relativa `/api/...`
(`apps/web/src/api/client.ts:52`) y no existe ninguna variable de entorno de build en el frontend.
Es también la razón por la que el proyecto **no** necesita `@fastify/cors` y por la que la cookie de
sesión puede mantenerse `httpOnly` + `SameSite=Lax` + `Secure`, sin atributo `Domain`
(ADR-0010:17-24 y `:68-70`).

**Verificación en vivo hecha hoy** (solo lecturas `GET`, ninguna acción de escritura):

```
GET https://inventienda-api.onrender.com/api/health   → 200  {"status":"ok","uptime":395.2,"db":"up"}
GET https://dmc-proyecto.vercel.app/api/health        → 200  {"status":"ok","uptime":396.8,"db":"up"}
GET https://dmc-proyecto.vercel.app/                  → 200
```

El sistema está arriba y el proxy de Vercel llega correctamente a Render y a Neon. El `uptime` de
~395 segundos en el momento de la prueba confirma que el proceso llevaba unos 6 minutos vivo, es
decir, que había arrancado hacía poco: comportamiento coherente con la suspensión por inactividad
del plan gratuito.

---

## Sistema de deployment propuesto

### Build

Hay **dos builds independientes**, cada uno disparado por su propia integración con el repositorio.
Ninguno de los dos lo ejecuta este repositorio: los ejecuta la plataforma.

**API (Render)** — `render.yaml:8-9`

```
buildCommand:  corepack enable && pnpm install --frozen-lockfile && pnpm --filter @inventienda/api build
startCommand:  node apps/api/dist/server.js
```

`pnpm --filter @inventienda/api build` es `tsc -p tsconfig.json`
(`apps/api/package.json:8`): compilación TypeScript a JavaScript ESM en `apps/api/dist/`. No hay
bundler, no hay Docker, no hay Dockerfile en el árbol (verificado: `find . -name "Dockerfile*"` no
devuelve nada).

**SPA (Vercel)** — `vercel.json:2-4`

```
installCommand:    pnpm install --frozen-lockfile
buildCommand:      pnpm --filter @inventienda/web build
outputDirectory:   apps/web/dist
```

`pnpm --filter @inventienda/web build` es `vite build` (`apps/web/package.json:8`).

**Determinismo — lo que sí está resuelto:**

- `--frozen-lockfile` en ambos builds: el árbol de dependencias no se resuelve de nuevo, se instala
  exactamente lo que `pnpm-lock.yaml` fija. Si el lockfile no coincide con los `package.json`, el
  build falla en vez de instalar algo distinto.
- `NODE_VERSION: "22"` fijado en `render.yaml:12-13`, alineado con `engines.node` de
  `package.json:6-8`.

**Determinismo — lo que no está resuelto:**

- **La versión de Node en Vercel no está fijada en el repositorio.** `vercel.json` no declara
  runtime de Node y no existe un `.nvmrc`. La versión la elige el panel de Vercel, fuera del
  control del árbol. Para un build estático de Vite el riesgo es bajo, pero es una entrada del build
  que no es reproducible desde el repositorio.
- **No hay filtros por ruta.** Ambas plataformas construyen ante cualquier push a `main`, sin
  importar qué cambió. Un commit que solo toca `docs/` o `openspec/` dispara igualmente el build de
  la API y el de la SPA. En un monorepo de dos aplicaciones el costo es tolerable; conviene saber
  que es una decisión por omisión, no una elección.

**Cómo cerrar el hueco de Node en Vercel:** agregar un `.nvmrc` con `22` en la raíz, o fijar la
versión de Node en la configuración del proyecto en el panel de Vercel. Es un cambio de un archivo
y no requiere tocar infraestructura.

### Artifact

No hay un artefacto versionado e inmutable en el sentido clásico (imagen de contenedor, tarball,
paquete publicado). El artefacto es **implícito y propiedad de cada plataforma**:

| Superficie | Qué se despliega en concreto | Cómo se traza al commit |
| --- | --- | --- |
| API | El contenido de `apps/api/dist/` producido por el build de Render, ejecutado por `node apps/api/dist/server.js` | Cada deploy de Render queda asociado al SHA del commit en su historial de deploys |
| SPA | El bundle estático de `apps/web/dist` subido al CDN de Vercel | Cada deployment de Vercel tiene una URL inmutable propia y su SHA de commit |

**Trazabilidad: existe, pero solo dentro del panel de cada plataforma.** La cadena
`commit → build → deploy → entorno` es reconstruible mirando Render y Vercel, no desde el sistema
en ejecución. Concretamente:

- **La aplicación no expone su propia versión.** `apps/api/package.json:3` dice `"version": "0.0.0"`
  y nunca cambia; `/api/health` devuelve `status`, `uptime` y `db` (`apps/api/src/routes/health.ts:34-38`),
  pero **no un SHA de commit ni un identificador de build**. Ante un incidente no hay forma de
  preguntarle al servicio en producción qué código está corriendo: hay que ir al panel de Render.
- Ningún tag de Git marca los releases (`git log` reciente no muestra tags de versión; el flujo son
  merges de PR a `main`).

**Cómo cerrar este hueco (barato y de alto valor):** Render expone el SHA del commit desplegado en
la variable de entorno `RENDER_GIT_COMMIT`. Agregar un campo `version` a la respuesta de
`/api/health` que lo lea convierte el health check en el punto de trazabilidad que hoy falta. Es un
cambio en `apps/api/src/routes/health.ts` más su esquema Zod, lo que implica regenerar el contrato
(`pnpm contract`) — es decir, un cambio con delta de spec, no un retoque. Vale la pena antes del
primer incidente real, no después.

### Config & Secrets

**Regla operativa de este repositorio: nunca se leen, escriben ni referencian archivos `.env*`**
(`CLAUDE.md`, sección "Never touch `.env*`"). Este plan documenta las variables **por nombre y
propósito**, jamás por valor. Para demostrar que no hay secretos commiteados se usan `.gitignore` y
`git ls-files`, nunca los archivos mismos — comprobado: `.gitignore:11-12` ignora `.env` y
`.env.local`, y `git ls-files` no lista ningún `.env` real.

**Inventario de variables de la API** (derivado de `apps/api/src/lib/env.ts:4-11`,
`render.yaml:11-23`, `.github/workflows/ci.yml:26-28`, `apps/api/src/app.ts:63-69` y
`apps/api/src/plugins/cookie.ts:19-28`):

| Variable | Clasificación | Propósito | Dónde vive en producción |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Secreto** | Cadena de conexión a Neon; la consume el pool (`apps/api/src/db/pool.ts:12`) y Drizzle Kit para migrar (`apps/api/drizzle.config.ts:9`) | Panel de Render, marcada `sync: false` en `render.yaml:20-21` — es decir, **deliberadamente ausente del blueprint** para que no viaje en el repositorio |
| `COOKIE_SECRET` | **Secreto** | Firma de la cookie de sesión; mínimo 32 caracteres (`lib/env.ts:10`) | Render la genera sola: `generateValue: true` (`render.yaml:22-23`). Nadie la escribe a mano y nadie necesita conocerla |
| `NODE_ENV` | Config | `production` activa el flag `Secure` de la cookie (`apps/api/src/auth/session.ts:23`), el fallo duro por secreto faltante (`plugins/cookie.ts:24-28`) y el logging de requests (`app.ts:64-68`) | `render.yaml:18-19`, valor `production` |
| `NODE_VERSION` | Config | Runtime de Node del servicio | `render.yaml:12-13`, valor `"22"` |
| `PORT` | Config | Puerto de escucha; por defecto `3000` (`lib/env.ts:6`) | Lo inyecta Render automáticamente; no está en el blueprint |
| `LOG_LEVEL` | Config | Nivel del logger de Fastify, por defecto `info` (`app.ts:68`) | Opcional. Su valor puede cambiarse **en el panel de Render sin redeploy** — así está documentado en `render.yaml:14-17` |
| `SEED_ENCARGADO_EMAIL` / `SEED_ENCARGADO_NOMBRE` | Config | Identidad del primer usuario `encargado` | Solo en la máquina que corre `pnpm seed:encargado`; no es una variable del servicio |
| `SEED_ENCARGADO_PASSWORD` | **Secreto** | Contraseña del bootstrap. El script **se niega explícitamente** a aceptarla por argumento de CLI para que no quede en el historial del shell ni en el listado de procesos (`apps/api/scripts/seed-encargado.ts:34-40`) | Solo en el entorno de quien ejecuta el seed |

**La SPA no tiene variables de entorno de build.** No hay ninguna `VITE_*`: la URL de la API no se
inyecta en el bundle, se resuelve por la ruta relativa `/api` (`apps/web/src/api/client.ts:52`) que
el rewrite de `vercel.json:5-9` traduce. Es una simplificación real y deseable — pero tiene una
consecuencia que se trata más abajo, en **Entornos**.

**Lo que está bien resuelto:**

- El fallo por configuración inválida es **duro y temprano**: `lib/env.ts:16-21` lanza con el
  detalle de cada campo inválido, y `plugins/cookie.ts:24-28` se niega a arrancar en producción sin
  `COOKIE_SECRET` en vez de caer al secreto de desarrollo. Un servicio mal configurado no arranca
  degradado: no arranca.
- El secreto de desarrollo commiteado (`plugins/cookie.ts:7`) está marcado como tal en el propio
  código y es inalcanzable en producción por la rama anterior.
- El logger de Fastify registra línea de request, estado y tiempo, **no cuerpos**, lo cual está
  verificado por sonda y documentado en `app.ts:58-62` — la contraseña de login no llega al log.

**Huecos:**

- No hay gestor de secretos ni rotación. Los secretos viven en el panel de cada plataforma. Para
  esta escala es una decisión defendible, pero **no hay procedimiento escrito de rotación de
  `COOKIE_SECRET` ni de `DATABASE_URL`**, y rotar `COOKIE_SECRET` invalida todas las sesiones
  activas: es un evento de usuario, no una operación silenciosa.
- No hay verificación automática de que los nombres de variables del código y los del panel de
  Render sigan coincidiendo. Si alguien agrega una variable a `lib/env.ts` y olvida cargarla en
  Render, el síntoma es el servicio que no arranca tras el deploy. El fallo es ruidoso, que es lo
  correcto, pero se descubre en producción.

### Infraestructura

Elegida en ADR-0010 con una restricción explícita y no negociable: **costo mensual cero** — el
proyecto no tiene presupuesto de infraestructura (ADR-0010:12-13). Todo lo demás se deriva de ahí.

```
                    navegador
                        │  (un solo origen: dmc-proyecto.vercel.app)
                        ▼
        ┌───────────────────────────────┐
        │  Vercel — CDN + SPA estática  │
        │  vercel.json:10-13  →  index.html (fallback SPA)
        │  vercel.json:5-9    →  rewrite /api/*
        └───────────────┬───────────────┘
                        │  proxy servidor-a-servidor (no redirect)
                        ▼
        ┌───────────────────────────────┐
        │  Render — 1 instancia Node    │
        │  plan: free, region: oregon   │  render.yaml:5-6
        │  healthCheckPath: /api/health │  render.yaml:10
        └───────────────┬───────────────┘
                        │  DATABASE_URL (TLS)
                        ▼
        ┌───────────────────────────────┐
        │  Neon — PostgreSQL gestionado │
        │  tier gratuito, autosuspend   │
        └───────────────────────────────┘
```

Alternativas consideradas y descartadas con razón escrita en ADR-0010:41-50 (Fly.io/Railway; Render
sirviendo también la SPA; dominio propio con CORS y `SameSite=None`). No se reabren aquí.

**Restricciones que impone esta infraestructura y que hay que respetar indefinidamente:**

1. **La cookie de sesión no debe llevar atributo `Domain`.** Si se le agrega, el proxy de Vercel
   —que reescribe el origen pero no redirige— rompe la sesión. Es una restricción permanente sobre
   `apps/api/src/plugins/cookie.ts` mientras esta arquitectura de proxy siga vigente
   (ADR-0010:68-70).
2. **Una sola instancia.** El rate limiting de `@fastify/rate-limit` es en memoria
   (`apps/api/src/app.ts:99`); con más de una instancia el límite se multiplicaría por el número de
   instancias. Hoy es correcto. Escalar horizontalmente exigiría un store compartido.
3. **Sin almacenamiento persistente en el servicio.** El proceso de Render no guarda estado en
   disco: todo el estado está en Neon. Esto es lo que hace que un redeploy sea seguro.
4. **Cold start.** El plan gratuito de Render suspende el proceso tras ~15 minutos de inactividad y
   la siguiente request puede tardar hasta ~50 segundos (ADR-0010:58-61). El cómputo de Neon también
   autosuspende, así que la primera consulta tras el ocio es notablemente más lenta
   (ADR-0010:62-64). Ver la sección **Verify & Observe** para el procedimiento de demo.

### Entornos

Hay **un solo entorno real: producción.** No existe staging.

| Entorno | Frontend | API | Base de datos |
| --- | --- | --- | --- |
| Desarrollo local | Vite dev server, proxy `/api` → `localhost:3000` (`apps/web/vite.config.ts:6-10`) | `tsx watch src/server.ts` | Docker Compose (`docker-compose.yml:1-17`) |
| CI | — (no se sirve) | — (no se sirve) | Servicio `postgres:16-alpine` efímero del runner (`.github/workflows/ci.yml:11-24`) |
| Producción | Vercel | Render | Neon |
| Staging | **no existe** | **no existe** | **no existe** |

**Riesgo de primer orden que este cuadro esconde: los preview deployments de Vercel apuntan a la
API y a la base de datos de producción.**

`vercel.json:8` codifica la URL de Render **literalmente**, y no hay ninguna variable de entorno que
la haga variar por entorno. Vercel construye un preview por cada pull request — se ve en los checks
del PR #53, donde aparecen `Vercel` y `Vercel Preview Comments` junto a los jobs de CI. Ese preview
sirve el frontend de la rama, pero reescribe `/api/*` al **mismo** servicio de Render y, por lo
tanto, a la **misma** base Neon que usan los usuarios reales.

Consecuencia concreta: probar un formulario nuevo en un preview de PR escribe filas reales en la
base de producción. No es hipotético, es el comportamiento por diseño de la configuración actual.

**Qué haría falta para cerrarlo,** en orden de costo creciente:

1. **Lo más barato (documental):** dejar constancia explícita — aquí y en el propio ADR-0010 — de
   que los previews de Vercel escriben en producción, y tratarlos como solo-lectura por convención
   del equipo. No cuesta nada y elimina la sorpresa. Es lo mínimo aceptable.
2. **Medio:** desactivar los preview deployments de Vercel para este proyecto (opción del panel), de
   modo que solo se despliegue `main`. Elimina el riesgo de raíz al costo de perder la vista previa.
3. **Completo:** un segundo servicio de Render apuntando a una rama de Neon (Neon soporta ramas de
   base de datos), más un `vercel.json` cuyo destino de rewrite dependa del entorno. Esto exige
   introducir una variable de build en la SPA o generar `vercel.json` en tiempo de build, y
   duplicaría el consumo del tier gratuito. Es la solución correcta cuando el proyecto tenga
   usuarios reales que perder.

La decisión entre las tres es del propietario; este plan no la toma.

### Estrategia de release

**Direct release con auto-deploy por push, sin ventana de aprobación.**

Ambas plataformas están conectadas al repositorio por su propia integración y despliegan solas:

- Render: `render.yaml:7` declara `branch: main`; el blueprint no fija `autoDeploy: false`, así que
  todo push a `main` dispara un build y un deploy.
- Vercel: la integración con GitHub despliega `main` a producción y cada PR a un preview.
- ADR-0010:26-30 lo dice sin ambigüedad: el workflow de CI **no despliega nada**; Vercel y Render
  "despliegan por su propia integración con el repositorio, no desde este workflow".

En consecuencia, **el momento del release es el merge del PR a `main`**. No hay promoción manual, ni
tag, ni aprobación intermedia.

**Modo de release del proceso de la API:** el plan gratuito de Render corre una sola instancia, de
modo que un deploy reemplaza el proceso. No es un rolling update: hay una ventana breve durante la
cual la API no responde mientras el proceso nuevo arranca y `healthCheckPath` (`render.yaml:10`)
pasa a verde. Para el volumen de uso de este proyecto es aceptable; conviene no describirlo como
"zero-downtime" porque no lo es.

**Por qué esta estrategia y no otra:** blue/green, canary o feature flags exigen dos entornos vivos
o un plano de control de flags. Con un solo servicio gratuito y sin staging, ninguno es
implementable hoy sin gastar dinero. Direct release es la única estrategia coherente con la
restricción de costo cero de ADR-0010 — pero eso hace que las secciones **Deploy gates** y
**Recovery** carguen todo el peso del riesgo.

**Declaración explícita e importante: revertir el código no revierte los datos.** Un rollback del
deploy de Render devuelve el proceso a un commit anterior; no deshace ni una sola fila escrita, ni
una sola migración aplicada a Neon. Ver **Data & Migrations** y **Recovery**.

### Data & Migrations

**Esta es la parte más afilada del sistema. Se documenta como riesgo de primer orden, no como nota
al pie.**

Herramienta: Drizzle Kit. Migraciones versionadas en `apps/api/drizzle/` (hoy `0000`…`0003`, con su
diario en `apps/api/drizzle/meta/_journal.json`). Comandos:

- `pnpm db:generate` → `drizzle-kit generate` (`package.json:19`, `apps/api/package.json:13`):
  compara `src/db/schema.ts` con el snapshot y **escribe** un archivo SQL nuevo en `drizzle/`.
- `pnpm db:migrate` → `drizzle-kit migrate` (`package.json:20`, `apps/api/package.json:14`):
  **aplica** las migraciones pendientes contra el `DATABASE_URL` que tenga cargado el entorno
  (`apps/api/drizzle.config.ts:9`).

#### El hecho central

**Las migraciones contra Neon se aplican MANUALMENTE, desde la máquina del desarrollador, con
`DATABASE_URL` apuntando a Neon.** El plan gratuito de Render no ofrece un pre-deploy command para
automatizarlas — está escrito en `docs/adrs/0010-despliegue-tiers-gratuitos.md:71-73` y repetido en
`CLAUDE.md`.

De ahí se sigue el modo de fallo más peligroso del proyecto, y conviene enunciarlo sin suavizarlo:

> Un cambio que agrega una tabla **se despliega limpio** —el build compila, el health check pasa,
> Render marca el deploy en verde— **y después devuelve 500 en cada ruta que toca esa tabla**, hasta
> que un ser humano se acuerde de correr la migración.

El health check no lo detecta: `/api/health` solo ejecuta `select 1`
(`apps/api/src/plugins/db.ts:12`), que sigue funcionando perfectamente contra una base a la que le
falta una tabla. **El sistema reportará `{"status":"ok","db":"up"}` mientras la aplicación está
rota.** Confiar en el semáforo verde de Render es, precisamente, la forma de no enterarse.

#### Por qué esto importa ahora mismo

El próximo cambio en la tubería es el ítem **#5 del backlog, `productos-ledger-base`**
(`docs/BACKLOG.md:36`), cuyo diseño ya está commiteado en
`openspec/changes/productos-ledger-base/design.md`. **Agrega dos tablas**, `productos` y
`movimientos`, con CHECKs, un índice único sobre `lower(sku)`, un índice `(producto_id, fecha)` y
una FK `productos.proveedor_id → proveedores.id`
(`openspec/changes/productos-ledger-base/design.md:129-139`).

Es exactamente el caso que dispara el modo de fallo descrito arriba. Cuando ese PR se mergee a
`main` sin haber migrado Neon antes, la SPA desplegará una sección de productos completa y cada
llamada a `/api/productos` devolverá 500.

#### Regla de ordenamiento (la parte accionable)

El orden correcto **depende del tipo de migración**. Invertirlo rompe producción en ambas
direcciones:

| Tipo de migración | Ejemplos | Orden obligatorio | Motivo |
| --- | --- | --- | --- |
| **Aditiva** (expand) | Tabla nueva, columna nueva anulable o con default, índice nuevo, CHECK sobre datos que ya cumplen | **Migrar Neon PRIMERO, después mergear a `main`** | El código viejo tolera el esquema nuevo: no conoce las tablas nuevas y no las consulta. La ventana entre migrar y desplegar es inofensiva. La ventana inversa —desplegar y todavía no migrar— es la que devuelve 500 |
| **Destructiva** (contract) | `DROP TABLE`, `DROP COLUMN`, renombrar, restringir un tipo, agregar `NOT NULL` sin default | **Mergear y desplegar PRIMERO, migrar Neon DESPUÉS de confirmar que el código nuevo está vivo y sano** | El código viejo todavía lee la columna que se va a borrar. Migrar antes lo rompe de inmediato |
| **Mixta** | Renombrar una columna en un solo paso | **Partirla en dos ciclos**: primero expand (agregar lo nuevo, escribir en ambos), desplegar; después contract (borrar lo viejo) en un ciclo posterior | Un solo paso no tiene orden seguro. Si el diseño exige una migración mixta, el diseño está incompleto |

**`productos-ledger-base` (#5) es puramente aditiva.** Por lo tanto: **migrar Neon antes de mergear
el PR.** Con las dos tablas ya creadas y ninguna ruta que las use aún, la base queda simplemente con
dos tablas vacías; en cuanto Render despliegue el código nuevo, todo funciona en el primer intento.

#### Lo que Drizzle Kit no da

**No hay migraciones de bajada.** Drizzle Kit no genera `down`. Deshacer un cambio de esquema
significa una de estas tres cosas, y ninguna es un botón:

1. Escribir una **migración nueva hacia adelante** que revierta el efecto (lo habitual y lo
   recomendado para cambios aditivos: un `DROP TABLE` de la tabla recién creada y vacía es seguro y
   trivial).
2. Restaurar la base desde el historial de Neon (branching / point-in-time restore). **Cuánta
   retención ofrece el tier gratuito hay que verificarlo en la consola de Neon antes de contar con
   ello** — este plan no lo afirma, porque no fue verificado. Verificarlo es una acción de lectura
   y debería hacerse antes del primer cambio que toque datos existentes.
3. Aceptar la pérdida y corregir hacia adelante.

**Corolario que se repite porque cuesta caro olvidarlo: el rollback del código en Render no toca
Neon.** Si un deploy malo escribió filas incorrectas, revertir el deploy detiene la hemorragia pero
deja las filas ahí.

#### Datos semilla

`pnpm seed:encargado` (`package.json:22`) crea el primer usuario `encargado`. Es un bootstrap
fuera de banda —la API de gestión de usuarios exige un encargado autenticado, así que el primero
tiene que existir antes— y se ejecuta una sola vez por base de datos. La contraseña se toma de
`SEED_ENCARGADO_PASSWORD` y el script **rechaza** recibirla por argumento de CLI
(`apps/api/scripts/seed-encargado.ts:34-40`).

### Deploy gates

**Aquí hay que ser precisos, porque el proyecto tiene una CI buena y, aun así, no tiene una
compuerta.**

Lo que CI **sí** hace — `.github/workflows/ci.yml`, un solo job `test` sobre `ubuntu-latest` con un
Postgres 16 efímero (`:11-24`) y las mismas credenciales que `docker-compose.yml`:

| Paso | Línea | Qué prueba |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | `:44` | El lockfile es coherente |
| `pnpm lint` (`biome ci .`) | `:47` | Estilo y reglas |
| `pnpm contract:check` | `:50` | El OpenAPI generado y `schema.d.ts` están al día respecto del código |
| `pnpm typecheck` | `:53` | Tipos en api + web |
| `pnpm db:migrate` | `:56` | **Las migraciones aplican limpio sobre una base vacía** |
| `pnpm test` | `:59` | Suites unitarias de api y web |
| `pnpm test:integration` | `:62` | Suites contra Postgres real, excluidas de la corrida por defecto |

Es una batería honesta y notablemente completa para el tamaño del proyecto. En particular, el paso
`db:migrate` de la línea 56 verifica que la migración nueva **es aplicable**, aunque no que alguien
la haya aplicado a Neon.

**Lo que CI no es: una compuerta.**

1. **`main` no tiene protección de rama.** Verificado hoy contra la API de GitHub:
   `GET /repos/j00su3/DMC_Proyecto/branches/main/protection` → `404 Branch not protected`. No hay
   checks requeridos, no hay revisión obligatoria, no hay restricción de push directo.
2. **CI y el deploy corren en paralelo, no en secuencia.** El disparador es
   `on: [push, pull_request]` (`ci.yml:3-5`); el de Render y Vercel es su propia integración con
   Git. Un push a `main` arranca las dos cosas a la vez. **Un check rojo y un deploy vivo pueden
   coexistir perfectamente.** Es exactamente el patrón que la propia skill de deploy señala como
   "no es una compuerta": un check informativo al lado de un auto-deploy.
3. **El disparador duplica trabajo.** `on: push` más `on: pull_request` hace que cada PR desde una
   rama del mismo repositorio corra el job `test` dos veces — se ve en los checks del PR #53, con
   dos entradas `test` (runs `33257246998` y `33257262907`), ambas en verde y ambas de ~2m15s.
   Consume minutos de Actions sin agregar señal.

**Cómo convertirlo en una compuerta real.** Las dos plataformas soportan lo necesario; no es un
límite técnico, es configuración que todavía no se hizo. En orden de esfuerzo:

- **Paso 1, el de mejor relación valor/costo:** activar protección de rama en `main` con el check
  `test` como requerido y prohibir el push directo. Con eso, código que no pasa CI no puede llegar a
  `main`, y como el deploy se dispara desde `main`, no puede desplegarse. **Esto solo ya convierte
  la CI en una compuerta efectiva**, sin tocar Render ni Vercel.
- **Paso 2, la compuerta explícita:** poner `autoDeploy: false` en `render.yaml`, crear un Deploy
  Hook en el panel de Render, guardar su URL como secreto de GitHub Actions y agregar al workflow un
  job final que la invoque **solo** si el job `test` pasó y la rama es `main`. El equivalente en
  Vercel es desconectar la integración de Git y usar un Deploy Hook, o configurar un "Ignored Build
  Step". Esto vuelve el despliegue una consecuencia de la CI verde, no un evento paralelo.
- **Paso 3, higiene:** cambiar el disparador a `on: pull_request` más `on: push: branches: [main]`
  para eliminar la ejecución duplicada.

Ninguno de estos pasos se ejecutó: los tres son cambios de configuración de infraestructura o del
repositorio y requieren autorización explícita. Están listados en **Autorizaciones pendientes**.

### Verify & Observe

**Verificar (¿funcionó?)**

Lo que existe automáticamente:

- **Health check de Render:** `healthCheckPath: /api/health` (`render.yaml:10`). Render no marca el
  deploy como vivo hasta que esa ruta responde 200.
- **Contenido del health check:** `apps/api/src/routes/health.ts:23-38` ejecuta `checkDb()`
  (`select 1`, `apps/api/src/plugins/db.ts:10-17`) y devuelve `{status, uptime, db}`; si la base no
  responde, lanza `SERVICE_UNAVAILABLE` con 503. La ruta es pública: `config: { auth: false }`
  (`health.ts:16`).

**Su límite, que conviene tener presente:** prueba conectividad, no esquema. Como se explicó en
**Data & Migrations**, `select 1` pasa contra una base a la que le falta una tabla. Un health check
verde no significa que la aplicación funcione.

Lo que **no** existe:

- **No hay smoke test post-deploy automatizado.** Nada verifica, después de un deploy, que el login
  funcione o que el proxy deje pasar `Set-Cookie`. ADR-0010:79-81 registra esto como pendiente
  explícito: *"registrar aquí el resultado del smoke test post-deploy (tarea 5.9 de
  `fundaciones-monorepo`) que confirma que el proxy de Vercel → Render deja pasar el header
  `Set-Cookie` sin alterarlo"*. **Sigue pendiente.** El proxy funciona en la práctica —hay sesiones
  reales— pero no está verificado ni registrado.
- Este plan reemplaza parcialmente ese hueco con la lista de comprobaciones manuales de la sección
  **Checklist de release**, que es ejecutable a mano hoy mismo.

**Observar (¿cómo va?)**

| Señal | Dónde | Estado |
| --- | --- | --- |
| Logs de la API | Panel de Render. El logger de Fastify solo está activo en producción (`apps/api/src/app.ts:63-69`), con nivel ajustable vía `LOG_LEVEL` **sin redeploy** (`render.yaml:14-17`). Registra línea de request, estado y tiempo — no cuerpos (`app.ts:58-62`) | ✅ existe |
| Errores 5xx | `app.setErrorHandler` los envía a `app.log.error` (`app.ts:110-116`), así que quedan en el log de Render | ✅ existe, pero solo visible mirando el panel |
| Logs del frontend / proxy | Panel de Vercel | ✅ existe |
| Métricas de la base | Consola de Neon | ✅ existe |
| **Seguimiento de errores** (Sentry o equivalente) | — | ❌ no existe |
| **Métricas de aplicación** (latencia, tasa de error, throughput) | — | ❌ no existe |
| **Alertas** (a alguien, cuando algo se rompe) | — | ❌ no existe |
| **Monitor de disponibilidad externo** | — | ❌ no existe |

**Consecuencia honesta: hoy nadie se entera de que producción está caída salvo que un usuario lo
diga o alguien mire el panel.** Para un proyecto en esta etapa puede ser una decisión aceptable, pero
debe ser una decisión, no un descubrimiento.

Cerrar el hueco de forma barata: un monitor externo gratuito golpeando `/api/health` cada 5 minutos
cumple dos funciones a la vez — avisa cuando el servicio devuelve algo distinto de 200 **y** mantiene
el proceso de Render despierto, eliminando el cold start. El costo es consumir horas del plan
gratuito de forma continua, así que conviene decidirlo a conciencia y no activarlo por reflejo.

**Procedimiento de demo (cold start).** Render suspende tras ~15 minutos de inactividad y la
siguiente request puede tardar ~50 segundos; Neon autosuspende su cómputo aparte (ADR-0010:58-64).
Antes de cualquier demostración en vivo:

```bash
# 5-10 minutos antes de la demo. Despierta Render y, con el select 1, también el cómputo de Neon.
curl -sS -w '\nhttp=%{http_code} tiempo=%{time_total}s\n' --max-time 90 \
  https://dmc-proyecto.vercel.app/api/health
```

Repetir hasta que `tiempo` baje del segundo. La primera respuesta puede tardar ~50 s: eso es el cold
start, no una falla. Mantener después una pestaña abierta o repetir el `curl` cada pocos minutos
hasta empezar.

### Recovery

**API — Render.** El historial de deploys de Render conserva los deploys anteriores exitosos y
permite volver a uno. Como el proceso no guarda estado en disco (todo el estado está en Neon),
volver atrás es seguro desde el punto de vista de la aplicación. Alternativa equivalente:
`git revert` del commit malo y push a `main`, que dispara un deploy nuevo — más lento, pero deja el
historial de Git coherente con lo que está corriendo, que a la larga vale más.

**SPA — Vercel.** Cada deployment tiene una URL inmutable propia; promover un deployment anterior a
producción desde el panel es prácticamente instantáneo y es el camino de recuperación más rápido de
todo el sistema. Es también el más inofensivo: el frontend no tiene estado.

**Base de datos — Neon.** No hay rollback automático (ver **Data & Migrations**). Las tres opciones
son: migración nueva hacia adelante que revierta; restauración desde el historial de Neon —cuya
retención en el tier gratuito **hay que verificar en la consola antes de depender de ella**—; o
corregir hacia adelante aceptando el estado actual.

**La asimetría que define la recuperación de este proyecto:**

```
código  →  rollback en minutos, en dos paneles, sin pérdida
datos   →  sin rollback automático; toda escritura posterior al deploy malo es real
```

Por eso el orden de migración de la sección **Data & Migrations** no es burocracia: es el mecanismo
que mantiene el rollback de código útil. Si una migración destructiva ya corrió, revertir el código
lo deja apuntando a un esquema que ya no existe, y el rollback deja de ser una recuperación para
convertirse en una segunda caída.

**Primer diagnóstico ante un incidente**, en este orden:

1. `curl https://dmc-proyecto.vercel.app/api/health` — ¿responde? ¿`db` dice `up`?
2. Si tarda ~50 s y luego responde bien: era cold start, no un incidente.
3. Si devuelve 503: la API está viva pero no alcanza Neon. Revisar la consola de Neon (¿suspendida,
   sobre cuota, credenciales rotadas?).
4. Si devuelve 502/504 desde el dominio de Vercel pero el dominio de Render responde directo:
   el problema es el rewrite (`vercel.json:5-9`) o el deploy de Vercel, no la API.
5. Si el health está verde pero rutas concretas devuelven 500: **sospechar primero de una migración
   no aplicada.** Comparar `apps/api/drizzle/meta/_journal.json` del commit desplegado contra la
   tabla de migraciones de Drizzle en Neon. Es el modo de fallo característico de este sistema.
6. Logs de Render para el stack trace real. Subir `LOG_LEVEL` a `debug` en el panel **no requiere
   redeploy** (`render.yaml:14-17`).

**No hay proceso de gestión de incidentes** —ni on-call, ni registro de incidentes, ni acuerdo de
tiempos de respuesta— y para un proyecto de un solo desarrollador probablemente no haga falta. Lo
que sí conviene tener es el hábito de anotar en este documento, en la sección final, cada deploy que
salió mal y cómo se resolvió.

---

## Checklist de release

Procedimiento completo para llevar un cambio a producción. **La migración manual contra Neon está en
su posición correcta según el tipo de migración** — leer la tabla de ordenamiento en
**Data & Migrations** antes de empezar.

En bash, con los shims de pnpm en el PATH:

```bash
export PATH="/c/Users/User/.corepack-shims:$PATH"
```

### Fase 0 — Antes de abrir el PR (local)

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm contract:check     # si falla: NO asumir drift real. Stagear los artefactos
                        # regenerados y volver a correr — compara contra el ÍNDICE de Git
pnpm typecheck
pnpm test
pnpm db:up              # levanta el Postgres local (contenedor inventienda-postgres-1)
pnpm db:migrate         # aplica las migraciones contra el Postgres LOCAL
pnpm test:integration
```

- [ ] Todo lo anterior en verde localmente.
- [ ] Si el cambio toca `src/db/schema.ts`: `pnpm db:generate` ejecutado y el archivo SQL nuevo de
      `apps/api/drizzle/` **commiteado junto con el código**. Una migración sin commitear es una
      migración que nadie va a poder aplicar.
- [ ] **Clasificar la migración: ¿aditiva o destructiva?** Anotarlo en la descripción del PR. De
      esta respuesta depende el orden de las fases 2 y 3.

### Fase 1 — Pull request

- [ ] PR abierto contra `main`.
- [ ] El job `test` de GitHub Actions está en verde (`gh pr checks <n>`). Aparece dos veces por el
      disparador duplicado; **ambas** tienen que estar en verde.
- [ ] El check de Vercel está en verde.
- [ ] **Consciente de que el preview de Vercel apunta a la API y la base de PRODUCCIÓN**
      (`vercel.json:8`). No usar el preview para probar escrituras salvo que se acepte escribir en
      la base real.
- [ ] Revisión aprobada según la práctica del proyecto.

### Fase 2 — Migración ADITIVA: aplicar a Neon ANTES de mergear

> Saltar esta fase si el cambio no incluye migraciones, o si son destructivas (en ese caso van en la
> fase 4).

- [ ] `DATABASE_URL` de Neon cargada en el entorno de la máquina que va a migrar. **No pegar la
      cadena de conexión en un chat, un issue, un log ni este documento.**
- [ ] Verificar contra qué base se va a correr **antes** de correr. Confirmar en la consola de Neon
      que es el proyecto y la rama correctos.

```bash
pnpm db:migrate     # drizzle-kit migrate contra Neon
```

- [ ] Confirmar en la consola de Neon que las tablas / columnas nuevas existen.
- [ ] Confirmar que la API **actual** (todavía el código viejo) sigue sana:

```bash
curl -sS https://dmc-proyecto.vercel.app/api/health
# esperado: {"status":"ok","uptime":<n>,"db":"up"}
```

Para `productos-ledger-base` (#5) esta fase crea `productos` y `movimientos` vacías. El código viejo
no las conoce y no las consulta: la ventana es inofensiva.

### Fase 3 — Merge y despliegue

- [ ] Merge del PR a `main`. **Este es el release**: dispara automáticamente el deploy de Render y
      el de Vercel, en paralelo y sin aprobación intermedia.
- [ ] Esperar a que el deploy de Render termine en verde (build + health check). En el plan gratuito
      tarda varios minutos.
- [ ] Esperar a que el deployment de producción de Vercel termine.

### Fase 4 — Migración DESTRUCTIVA: aplicar a Neon DESPUÉS del deploy

> Solo para migraciones que borran o restringen. Si el cambio es aditivo, ya se migró en la fase 2.

- [ ] Confirmar que el código nuevo está vivo y sano (fase 5 completa y en verde).
- [ ] Recién entonces: `pnpm db:migrate` con la `DATABASE_URL` de Neon.

### Fase 5 — Verificación post-deploy (manual; hoy no está automatizada)

```bash
# 1. La API responde y alcanza la base
curl -sS -w '\nhttp=%{http_code} tiempo=%{time_total}s\n' --max-time 90 \
  https://inventienda-api.onrender.com/api/health

# 2. El proxy de Vercel llega a la API (mismo resultado, distinto camino)
curl -sS -w '\nhttp=%{http_code} tiempo=%{time_total}s\n' --max-time 90 \
  https://dmc-proyecto.vercel.app/api/health

# 3. La SPA se sirve
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://dmc-proyecto.vercel.app/
```

- [ ] Los tres devuelven 200 y el health dice `{"status":"ok",...,"db":"up"}`. La primera llamada
      puede tardar ~50 s por cold start: es esperable, no un fallo.
- [ ] **En el navegador:** iniciar sesión con un usuario real. Es el smoke test que cubre lo que el
      health check no cubre — que el proxy deja pasar `Set-Cookie` sin alterarlo (el pendiente de
      ADR-0010:79-81) y que la sesión persiste entre navegaciones.
- [ ] **Ejercitar al menos una ruta que toque las tablas del cambio.** Este es el paso que detecta
      la migración olvidada, y el único que la detecta: el health check no puede.
- [ ] Revisar los logs de Render en busca de 5xx durante los minutos posteriores al deploy.
- [ ] Si el cambio afectó permisos: verificar con **ambos** roles, `encargado` y `deposito`. La
      autorización es del servidor (403); lo que la SPA oculta es solo una comodidad visual.

### Fase 6 — Registro

- [ ] Anotar el resultado en **Registro de ejecución y verificación**, al final de este documento:
      qué se desplegó, cuándo, si hubo migración y de qué tipo, qué mostró la verificación y qué
      salió mal si algo salió mal. **Especialmente si algo salió mal**: es el único mecanismo que
      tiene este proyecto para que el próximo release no repita el error.
- [ ] Si el cambio confirmó por fin el smoke test de `Set-Cookie`, registrarlo en ADR-0010:79-81 y
      cerrar ese pendiente.

---

## Procedimiento de rollback, por superficie

**Antes de tocar nada, responder una pregunta: ¿corrió una migración en este release?** La respuesta
cambia todo lo que sigue.

### SPA (Vercel) — el más rápido y seguro

1. Panel de Vercel → proyecto → Deployments.
2. Localizar el último deployment de producción bueno (identificable por su SHA de commit).
3. Promoverlo a producción ("Promote to Production" / "Instant Rollback").
4. Verificar: `curl -sS -o /dev/null -w 'http=%{http_code}\n' https://dmc-proyecto.vercel.app/`
5. Verificar en el navegador que la SPA carga la versión anterior (limpiar caché si hace falta).

Sin estado, sin datos, reversible: si hace falta volver a la versión nueva, se promueve de vuelta.

### API (Render)

1. Panel de Render → servicio `inventienda-api` → Deploys.
2. Localizar el último deploy exitoso anterior al incidente y volver a él desde el historial.
3. Alternativa que deja Git coherente con lo desplegado: `git revert <sha>` en `main` y push, que
   dispara un deploy nuevo. Más lento, pero preferible cuando el arreglo va a tardar.
4. Esperar a que el health check vuelva a verde y verificar:

```bash
curl -sS --max-time 90 https://inventienda-api.onrender.com/api/health
```

5. **Comprobar la compatibilidad con el esquema.** Si en este release corrió una migración
   destructiva, el código viejo puede estar buscando una columna que ya no existe. En ese caso el
   rollback de código **no** es una recuperación: hay que arreglar hacia adelante.

### Base de datos (Neon) — no hay botón

**Drizzle Kit no genera migraciones de bajada.** Las opciones reales, en orden de preferencia:

1. **Migración nueva hacia adelante** que revierta el efecto. Para un cambio aditivo recién
   desplegado —tablas nuevas y vacías— un `DROP TABLE` es seguro y trivial. Se genera con
   `pnpm db:generate` sobre un `schema.ts` corregido, se revisa el SQL a mano y se aplica con
   `pnpm db:migrate`. Es el camino normal y el que debería usarse casi siempre.
2. **Restauración desde el historial de Neon** (branching / point-in-time restore). **Verificar
   primero en la consola de Neon qué retención ofrece el tier gratuito**: este plan no lo afirma
   porque no fue verificado. Restaurar a un punto anterior **descarta todas las escrituras
   posteriores a ese punto**, incluidas las legítimas de usuarios reales. Es una decisión de
   producto, no de operaciones, y solo el propietario puede tomarla.
3. **Corregir hacia adelante** aceptando el estado actual de los datos. Casi siempre es lo correcto
   cuando ya hay usuarios reales operando.

### Regla que cierra la sección

> Revertir el código en Render y Vercel toma minutos y no pierde nada.
> Revertir los datos en Neon puede ser imposible.
> Por eso el orden de la migración —fase 2 para aditivas, fase 4 para destructivas— es la única
> protección real que tiene este proyecto.

---

## Resumen de cobertura por etapa

| Etapa | Estado | Evidencia / hueco |
| --- | --- | --- |
| **Build** | ✅ Cubierta | `render.yaml:8-9`, `vercel.json:2-4`, `--frozen-lockfile` en ambos. Hueco menor: versión de Node de Vercel no fijada en el repositorio |
| **Artifact** | ⚠️ Parcial | Artefacto implícito de cada plataforma; trazable solo desde sus paneles. La aplicación no expone su SHA de commit |
| **Config & Secrets** | ✅ Cubierta | `render.yaml:11-23` (`sync: false`, `generateValue: true`), validación dura en `lib/env.ts:16-21` y `plugins/cookie.ts:24-28`. Sin procedimiento de rotación |
| **Infraestructura** | ✅ Cubierta y decidida | ADR-0010 completo, con alternativas y trade-offs escritos |
| **Entornos** | ❌ Hueco | No hay staging. **Los previews de Vercel apuntan a la API y la base de producción** (`vercel.json:8`) |
| **Estrategia de release** | ⚠️ Parcial | Direct release por auto-deploy. Coherente con la restricción de costo cero, pero sin ventana de aprobación |
| **Data & Migrations** | ❌ Hueco crítico | Migración manual contra Neon (ADR-0010:71-73). Sin migraciones de bajada. El orden depende del tipo y no está automatizado |
| **Deploy gates** | ❌ Hueco | CI completa (`ci.yml:44-62`) pero **informativa**: `main` sin protección de rama (verificado: 404 Branch not protected) y auto-deploy en paralelo |
| **Verify & Observe** | ⚠️ Parcial | Health check real (`render.yaml:10`, `health.ts:23-38`) y logs en los paneles. Sin smoke test automatizado (ADR-0010:79-81 sigue pendiente), sin métricas, sin alertas |
| **Recovery** | ⚠️ Parcial | Rollback de código disponible en ambos paneles. Sin rollback de datos y sin proceso de incidentes |

---

## Autorizaciones pendientes

**Ninguna acción de las siguientes fue ejecutada.** Cada una modifica infraestructura, configuración
de producción o datos, y requiere autorización explícita del propietario **para esa acción concreta,
en ese momento concreto**. No se aprueban en bloque.

| # | Acción | Superficie | Reversible | Estado |
| --- | --- | --- | --- | --- |
| 1 | Activar protección de rama en `main` con el check `test` como requerido | GitHub | Sí | ⬜ Pendiente |
| 2 | Poner `autoDeploy: false` en `render.yaml` y disparar el deploy desde CI vía Deploy Hook | Render + GitHub | Sí | ⬜ Pendiente |
| 3 | Cambiar el disparador de CI para eliminar la corrida duplicada del job `test` | GitHub | Sí | ⬜ Pendiente |
| 4 | Decidir cómo tratar los previews de Vercel (documentar / desactivar / separar entorno) | Vercel | Depende de la opción | ⬜ Pendiente — decisión del propietario |
| 5 | Fijar la versión de Node de Vercel (`.nvmrc` o panel) | Repositorio o Vercel | Sí | ⬜ Pendiente |
| 6 | Agregar el SHA de commit a `/api/health` (implica delta de contrato) | `apps/api` | Sí | ⬜ Pendiente |
| 7 | Verificar en la consola de Neon la retención del historial del tier gratuito | Neon (solo lectura) | N/A | ⬜ Pendiente |
| 8 | Aplicar la migración de `productos-ledger-base` (#5) contra Neon | **Neon — irreversible** | **No automáticamente** | ⬜ Pendiente |
| 9 | Contratar o activar un monitor externo sobre `/api/health` | Externo | Sí | ⬜ Pendiente — decisión del propietario |
| 10 | Rotar `COOKIE_SECRET` o `DATABASE_URL` | Render / Neon | Invalida sesiones | ⬜ Pendiente — solo ante incidente |

---

## Registro de ejecución y verificación

### 2026-08-29 — Deploy Pass inicial (solo DISCOVER + DESIGN)

**Qué se ejecutó:** únicamente inspección de solo lectura. Lectura del árbol del repositorio;
`git log`, `git status`, `git ls-files`; `gh run list`, `gh pr checks 53`,
`gh api .../branches/main/protection`; y tres `curl` `GET` contra las URLs públicas.

**No se ejecutó:** ningún deploy, ningún rollback, ninguna migración, ningún cambio de
infraestructura, ninguna rotación de secretos, ningún commit. No se leyó, escribió ni referenció
ningún archivo `.env*`.

**Qué mostró la verificación en vivo:**

| Comprobación | Resultado |
| --- | --- |
| `GET https://inventienda-api.onrender.com/api/health` | `200` en 0,26 s — `{"status":"ok","uptime":395.2,"db":"up"}` |
| `GET https://dmc-proyecto.vercel.app/api/health` | `200` en 0,61 s — `{"status":"ok","uptime":396.8,"db":"up"}` (el rewrite de `vercel.json:5-9` funciona) |
| `GET https://dmc-proyecto.vercel.app/` | `200` en 0,45 s |
| Últimas 8 corridas de CI | Todas `success` |
| Checks del PR #53 | `Vercel` pass, `Vercel Preview Comments` pass, `test` pass ×2 (duplicado por el disparador) |
| Protección de rama de `main` | **404 Branch not protected** — no hay compuerta |
| Migraciones en el árbol | 4 aplicadas: `0000`…`0003` (`apps/api/drizzle/meta/_journal.json`) |

El `uptime` de ~395 s en ambas rutas confirma que las dos llegan al **mismo** proceso de Render, y
que ese proceso llevaba unos 6 minutos vivo — coherente con la suspensión por inactividad del plan
gratuito.

**Lo más riesgoso que se encontró:** el próximo cambio del backlog (#5, `productos-ledger-base`)
agrega dos tablas y **se desplegará en verde y devolverá 500 en cada ruta de productos** si se
mergea antes de correr la migración manual contra Neon. El health check no lo va a detectar. Ver la
fase 2 del checklist de release.

**Próximo paso:** este plan requiere aprobación explícita del propietario antes de pasar a GENERATE
(generar workflows, scripts o configuración). No se generó ni se modificó ningún archivo del
proyecto fuera de este documento.

### 2026-09-01 — Incidente: `POST /api/ventas` devolvía 500 en producción

**Qué se rompió:** la migración `0006_magical_mandarin` (tablas `ventas`/`items_venta`/`pagos` +
la secuencia del correlativo, backlog #7) nunca se aplicó a mano contra Neon después de mergear ese
ciclo — exactamente el riesgo que este mismo documento ya había anticipado (más arriba, para el
ítem #5). El health check no lo detectó porque solo corre `select 1`.

**Síntoma:** confirmar una venta devolvía `500 INTERNAL_ERROR` genérico. `GET
/api/ventas/recibo` (búsqueda por correlativo) también devolvía `INTERNAL_ERROR` en vez del
`SALE_NOT_FOUND` tipado que debería — la señal de que faltaban tablas, no de que faltaba un dato.

**Diagnóstico:** DevTools → pestaña Network → la fila de la request fallida → sub-pestaña Response
(no Preview) mostró el cuerpo crudo del error; cruzado con `apps/api/drizzle/meta/_journal.json`,
que confirmó `0006` como la última migración en el árbol.

**Arreglo:** el usuario corrió `pnpm db:migrate` a mano contra su propio `DATABASE_URL` de Neon.
Confirmado funcionando de inmediato.

**Lección para el checklist de release:** cualquier PR que agregue tablas necesita su línea propia
en este registro confirmando que la migración corrió contra Neon — un merge en verde no es
evidencia de eso.

### 2026-09-01 — Migración `0007_giant_cerebro` aplicada (backlog #9, anulación de venta)

**Qué se agregó:** columnas `anuladaPor`/`anuladaEn`/`motivoAnulacion` en `ventas` + el CHECK
`ventas_anulacion_datos_solo_anulada`, migración additiva shippeada en PR #130. Toda fila existente
(`confirmada`, 3 columnas `NULL`) satisface el CHECK sin intervención.

**Aplicación a Neon:** corrida a mano por el usuario (`pnpm db:migrate` contra su `DATABASE_URL`)
después de que PR #133 (archive) ya estaba mergeado — mismo patrón manual que el incidente de
arriba, esta vez sin ventana de 500 porque se corrió antes de que nadie ejecutara el flujo de
anulación en producción. Confirmado funcionando probando una anulación real contra el demo en vivo.

**Nota de proceso:** la entrada de arriba (`2026-09-01 — Incidente...`) se había escrito en una
sesión anterior pero nunca llegó a commitearse — quedó como cambio local sin guardar y se perdió en
un `git checkout`/`git reset` posterior de esa misma noche. Reconstruida acá desde el resumen de
la conversación para no perder el registro; el claims-gate de `anulacion-venta` (ver
`openspec/changes/archive/2026-09-01-anulacion-venta/claims-report.md`, claim #23) fue lo que hizo
notar la ausencia de esta entrada para la migración `0007`.
