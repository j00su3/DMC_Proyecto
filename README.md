# InvenTienda

Sistema de gestión de inventario para un comercio pequeño, con dos roles (`encargado` y
`deposito`): catálogo de productos, proveedores, movimientos de stock auditables, punto de venta,
recibo interno con anulación de venta, y un motor de alertas de stock bajo/quiebre/discrepancia.

## Demo en vivo

**https://dmc-proyecto.vercel.app**

- Iniciá sesión con un usuario `encargado` para ver el sistema completo (gestión de usuarios,
  proveedores, productos, movimientos, punto de venta).
- El plan gratuito de Render suspende la API tras ~15 min de inactividad; la primera request
  después de eso puede tardar hasta ~50s en responder (cold start) — es esperable, no una falla.
  Si vas a hacer una demo en vivo, golpeá `https://dmc-proyecto.vercel.app/api/health` un par de
  minutos antes para "despertar" el servicio.

## Stack técnico

| Capa | Tecnología |
| --- | --- |
| API | Fastify 5 + Zod + Drizzle ORM sobre PostgreSQL |
| SPA | React 19 + Vite, TanStack Query/Router, react-hook-form |
| Base de datos | PostgreSQL (Neon en producción, Docker Compose en local) |
| Infraestructura | SPA en Vercel, API en Render, monorepo pnpm |

## Documentación

Todo el proceso de diseño y decisiones del proyecto está documentado en `docs/`:

| Documento | Contenido |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | Requerimientos de producto |
| [`docs/TECH-DESIGNv2.md`](docs/TECH-DESIGNv2.md) | Diseño técnico vigente (autoritativo) |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Backlog completo, con estado de cada ítem |
| [`docs/adrs/`](docs/adrs) | Decisiones de arquitectura (ADRs) |
| [`docs/REVISION-ADVERSARIAL.md`](docs/REVISION-ADVERSARIAL.md) | Revisión adversarial del diseño |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Pase de seguridad original y su cierre |
| [`SECURITY-REPORT.md`](SECURITY-REPORT.md) | Pase de seguridad independiente más reciente (2026-09-01), con hallazgos y fixes ya mergeados |
| [`docs/DEPLOY-PLAN.md`](docs/DEPLOY-PLAN.md) | Plan y checklist de despliegue |

El proyecto se desarrolló con un flujo de Spec-Driven Development: cada feature del backlog pasa
por `openspec/changes/<item>/` (propuesta → spec → diseño → tareas → implementación → verificación)
antes de promoverse a `openspec/specs/` y archivarse. El historial completo de ciclos cerrados está
en `openspec/changes/archive/`.

## Desarrollo local

Requiere Node 22 y `pnpm` (via Corepack).

```bash
pnpm install --frozen-lockfile
pnpm db:up                    # Postgres local vía Docker Compose
pnpm db:migrate                # aplica las migraciones
pnpm seed:encargado             # crea el primer usuario encargado (ver variables abajo)
pnpm dev                        # API en :3000, SPA en :5173
```

`pnpm seed:encargado` toma `SEED_ENCARGADO_EMAIL`, `SEED_ENCARGADO_NOMBRE` y
`SEED_ENCARGADO_PASSWORD` (mínimo 12 caracteres) del entorno — nunca por argumento de línea de
comandos.

### Comandos útiles

```bash
pnpm -r test            # suites unitarias, api + web
pnpm typecheck
pnpm lint
pnpm test:integration   # requiere pnpm db:up
```

## Estado del proyecto

Backlog #1 al #10 archivados y en producción (fundaciones, autenticación, usuarios, proveedores
con vista maestro-detalle, productos, movimientos de inventario, punto de venta, recibo interno,
anulación de venta y motor de alertas de stock). Ver [`docs/BACKLOG.md`](docs/BACKLOG.md) para el
detalle y lo que sigue pendiente (#11 en adelante).
