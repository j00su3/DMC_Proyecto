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
`@fastify/cookie` MUST be registered with `httpOnly`, `SameSite=Lax`, and a signing `secret` sourced from a new required env var; the `secure` flag MUST be `true` in production and MAY be `false` in local development (env-conditioned). The cookie MUST NOT carry a `Domain` attribute (ADR-0010). The plugin now carries the session token issued by `auth-sessions` login/logout.

#### Scenario: Cookie plugin registered
- GIVEN the API boots with the signing secret env var set
- WHEN `POST /api/auth/login` sets the session cookie
- THEN it is issued with `httpOnly`, `SameSite=Lax`, a valid signature, and no `Domain` attribute

#### Scenario: Missing signing secret fails fast
- GIVEN the cookie signing secret env var is unset or empty
- WHEN the API attempts to start
- THEN startup fails with a validation error (fail-fast, consistent with existing `lib/env.ts` pattern)

#### Scenario: Secure flag is env-conditioned
- GIVEN the API is running with `NODE_ENV=production`
- WHEN a session cookie is set
- THEN the cookie's `Secure` attribute is `true`

#### Scenario: Secure flag relaxed in local development
- GIVEN the API is running in local development (non-production `NODE_ENV`)
- WHEN a session cookie is set
- THEN the cookie's `Secure` attribute MAY be `false` to allow non-HTTPS local testing

#### Scenario: No Domain attribute ever
- GIVEN any environment (local, CI, production)
- WHEN a session cookie is set
- THEN the cookie response header contains no `Domain` attribute

### Requirement: ADR Supersession
The system MUST add `adrs/0010-deployment-free-tiers.md` documenting the Vercel/Render/Neon decision and explicitly superseding ADR-0009.

#### Scenario: ADR recorded
- GIVEN the deployment wiring is complete
- WHEN `adrs/0010-deployment-free-tiers.md` is reviewed
- THEN it states the free-tier decision and marks ADR-0009 as superseded
