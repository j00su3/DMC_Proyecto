# Delta Spec: deployment-wiring

## MODIFIED Requirements

### Requirement: Cookie Plugin Foundation
`@fastify/cookie` MUST be registered with `httpOnly`, `SameSite=Lax`, and a signing `secret` sourced from a new required env var; the `secure` flag MUST be `true` in production and MAY be `false` in local development (env-conditioned). The cookie MUST NOT carry a `Domain` attribute (ADR-0010). The plugin now carries the session token issued by `auth-sessions` login/logout.
(Previously: registered with `httpOnly`/`SameSite=Lax` only, unsigned, no `secure` flag, no auth/session logic implemented, explicitly required to not preclude adding auth later.)

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
