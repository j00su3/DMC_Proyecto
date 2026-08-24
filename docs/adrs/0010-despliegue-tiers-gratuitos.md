# ADR 0010: Despliegue — tiers gratuitos (Vercel + Render + Neon)

## Estado

Aceptado 2026-08-24 — reemplaza a [[0009-despliegue-local]].

## Contexto

Los criterios de éxito del PRD (≥ 30 % menos discrepancias en 1–2 ciclos de conteo, validar la
matriz de permisos con la operación real, calibrar alertas con datos reales) exigen usuarios reales
operando el sistema. Un despliegue `localhost`-solo los hace inmedibles por construcción — la
condición de revisión que el propio ADR-0009 dejó explícita. El costo mensual sigue teniendo que
ser cero: el proyecto no tiene presupuesto de infraestructura.

## Decisión

La SPA se despliega en **Vercel**, la API en **Render** (tier gratuito) y la base de datos en
**Neon Postgres** (gestionado, tier gratuito). `vercel.json` reescribe `/api/:path*` hacia el
servicio de Render, de modo que el navegador solo ve el origen de Vercel: no hay que introducir
`@fastify/cors` ni relajar la cookie de sesión, que sigue siendo `httpOnly` + `SameSite=Lax`
([ADR-0007](0007-sesion-cookie-rbac-propio.md)) sin atributo `Domain`. Docker Compose se mantiene
sin cambios como entorno de Postgres para desarrollo local
([ADR-0009](0009-despliegue-local.md)). Las migraciones (Drizzle Kit) se aplican con
`DATABASE_URL` apuntando al entorno correspondiente — Docker local o Neon.

`.github/workflows/ci.yml` agrega un job mínimo con `services.postgres` (mismas credenciales que
`docker-compose.yml`) que corre lint, `contract:check`, typecheck, migración y tests en cada push y
pull request — sin desplegar nada, solo validar que el árbol compila y migra limpio antes de que un
push llegue a Vercel/Render (que despliegan por su propia integración con el repositorio, no desde
este workflow).

**Orden de puesta en marcha (trampa de dependencia circular):** el servicio de Render no tiene URL
hasta que se crea, pero `vercel.json` necesita esa URL para el rewrite antes del primer deploy de
Vercel. `vercel.json` se commitea con un placeholder
(`https://RENDER-URL-PLACEHOLDER.onrender.com`) que debe reemplazarse por la URL real de Render
**antes** del primer deploy de Vercel — si Vercel despliega primero con el placeholder, todas las
llamadas a `/api/*` fallan hasta el próximo deploy.

## Alternativas consideradas

- **Fly.io / Railway** — tiers gratuitos equivalentes en espíritu (proceso persistente + Postgres),
  pero sin ventaja concreta sobre Render+Neon para este proyecto y con menos experiencia previa del
  equipo con esas plataformas. Se descartó por no aportar diferencia real.
- **Render sirviendo también la SPA** (build estático en el mismo servicio) — evita el proxy de
  Vercel, pero pierde el CDN y el pipeline de build de Vercel para el frontend, y complica servir
  SPA + API desde el mismo proceso Node sin ganar nada a cambio.
- **Dominio propio + CORS con `SameSite=None`** — permitiría un origen distinto por servicio sin
  proxy, pero debilita la postura de ADR-0007 (`SameSite=Lax` cierra la mayor parte del riesgo CSRF
  sin CORS) y agrega el costo de un dominio. Se descartó: el rewrite de Vercel logra el mismo
  resultado (un origen único) sin ese costo ni ese riesgo.

## Consecuencias

- Costo mensual sigue en cero; los tres proveedores (Vercel, Render, Neon) tienen tier gratuito
  suficiente para este volumen de uso.
- HTTPS gratis en Vercel y Render habilita el atributo `Secure` completo de la cookie de sesión
  (ADR-0007), algo que ADR-0009 dejaba pendiente por no tener HTTPS en `localhost`.
- **Trade-off — cold start:** el free tier de Render suspende el proceso tras ~15 minutos de
  inactividad; la siguiente request tarda hasta ~50 segundos en responder mientras el servicio
  arranca de nuevo. Es una degradación de UX aceptada mientras el proyecto no tenga tráfico
  constante.
- **Trade-off — autosuspend de Neon:** el cómputo de Neon también se suspende por inactividad; la
  primera query tras un período ocioso es notablemente más lenta que las siguientes (el cómputo
  tiene que "despertar").
- **Trade-off — orden de despliegue:** la URL de Render debe capturarse y cargarse en `vercel.json`
  **antes** del primer deploy de Vercel (ver "Orden de puesta en marcha" arriba); es un paso manual
  de un solo uso, no automatizable sin conocer la URL de antemano.
- **Trade-off — la cookie no debe llevar atributo `Domain`:** si se le agrega, el proxy de Vercel
  (que reescribe el origen pero no lo redirige) rompe la cookie de sesión. Es una restricción a
  respetar en `plugins/cookie.ts` indefinidamente mientras esta arquitectura de proxy siga vigente.
- Las migraciones contra Neon en v1 se ejecutan manualmente desde la máquina del desarrollador
  (`pnpm db:migrate` con `DATABASE_URL` de Neon) — Render free no ofrece un pre-deploy command
  para automatizarlas.
- El OpenAPI generado por el pipeline de contrato (`apps/api/openapi.json`) queda en versión
  **3.0.3** — no afecta esta decisión de despliegue, se deja registrado porque es información que
  cualquier consumidor externo del contrato (p. ej. al integrar el proxy o herramientas de
  documentación) necesita saber.

**Pendiente:** registrar aquí el resultado del smoke test post-deploy (tarea 5.9 de
`fundaciones-monorepo`) que confirma que el proxy de Vercel → Render deja pasar el header
`Set-Cookie` sin alterarlo.
