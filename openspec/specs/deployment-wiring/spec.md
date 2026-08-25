# Delta Spec: deployment-wiring

New capability (greenfield, no prior spec).

## ADDED Requirements

### Requirement: SPA Deployment on Vercel
`apps/web` MUST deploy to Vercel as a static/SPA build triggered from GitHub.

#### Scenario: Vercel deploy on push
- GIVEN a push to the deployment branch
- WHEN Vercel builds
- THEN the SPA build succeeds and deploys

### Requirement: API Deployment on Render
`apps/api` MUST deploy to Render (free tier) as a Node service triggered from GitHub.

#### Scenario: Render deploy on push
- GIVEN a push to the deployment branch
- WHEN Render builds
- THEN the API service deploys and starts successfully

### Requirement: Same-Origin API Proxy
Vercel MUST rewrite `/api/*` requests to the Render backend so the SPA and API share one logical origin, preserving `SameSite=Lax` cookie behavior per ADR-0007.

#### Scenario: Proxied request preserves cookie origin
- GIVEN the SPA calls `/api/health` through the Vercel rewrite
- WHEN the response sets or reads a cookie
- THEN the cookie is treated as same-origin (no cross-site SameSite failure)

### Requirement: Managed Database on Neon
Production MUST use Neon Postgres, connected via `DATABASE_URL`, with no other production DB path.

#### Scenario: Production connects to Neon
- GIVEN the Render service's `DATABASE_URL` points to Neon
- WHEN the API starts
- THEN it connects successfully to the Neon instance

### Requirement: Cookie Plugin Foundation
`@fastify/cookie` MUST be registered with `httpOnly` and `SameSite=Lax`, with no session/auth logic implemented yet, and MUST NOT preclude adding auth later.

#### Scenario: Cookie plugin registered
- GIVEN the API boots
- WHEN a route sets a cookie
- THEN it is issued with `httpOnly` and `SameSite=Lax` and no auth state is required

### Requirement: ADR Supersession
The system MUST add `adrs/0010-deployment-free-tiers.md` documenting the Vercel/Render/Neon decision and explicitly superseding ADR-0009.

#### Scenario: ADR recorded
- GIVEN the deployment wiring is complete
- WHEN `adrs/0010-deployment-free-tiers.md` is reviewed
- THEN it states the free-tier decision and marks ADR-0009 as superseded
