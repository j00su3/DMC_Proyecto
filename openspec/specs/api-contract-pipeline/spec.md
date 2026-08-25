# Delta Spec: api-contract-pipeline

New capability (greenfield, no prior spec).

## ADDED Requirements

### Requirement: Error Envelope Shape
All error responses MUST use `{ error: { code, message, details? } }`.

#### Scenario: Validation error shape
- GIVEN an invalid request body
- WHEN the API rejects it
- THEN the response body matches the error envelope with a stable `code`

### Requirement: Pagination Envelope Shape
List endpoints MUST accept `?page&pageSize` and respond with `{ data, page, pageSize, total }`.

#### Scenario: Default pagination
- GIVEN a list endpoint called with no query params
- WHEN it responds
- THEN `page`/`pageSize` MUST use documented defaults and `total` reflects full count

#### Scenario: Explicit pagination
- GIVEN `?page=2&pageSize=10`
- WHEN the endpoint responds
- THEN `data` MUST contain at most 10 items and `page`/`pageSize` echo the request

### Requirement: OpenAPI Generation from Zod
The system MUST generate an OpenAPI spec from Zod route schemas via `fastify-type-provider-zod` and write it to disk only; it MUST NOT expose a runtime spec route in this change.

#### Scenario: Spec written on build
- GIVEN the build/generation script runs
- WHEN it completes
- THEN an OpenAPI JSON file exists on disk and no `/openapi.json`-style route is registered

### Requirement: SPA Type Generation
The system MUST generate TypeScript types for `apps/web` from the written OpenAPI spec via `openapi-typescript`, with no hand-edited generated types.

#### Scenario: Types regenerate from spec
- GIVEN a changed Zod route schema
- WHEN the spec is regenerated and types run
- THEN the generated TS types reflect the schema change with no manual edits

### Requirement: Health Endpoint Verifiable Slice
The system MUST expose a health endpoint returning one combined result covering process liveness and DB connectivity, built test-first (Vitest) and exercising the error and pagination envelope shapes.

#### Scenario: Healthy state
- GIVEN the API process is running and the DB is reachable
- WHEN `GET /health` (or equivalent) is called
- THEN it returns a 200 with a combined success body indicating both checks passed

#### Scenario: DB unreachable
- GIVEN the DB connection fails
- WHEN the health endpoint is called
- THEN it returns a non-2xx response using the standard error envelope shape
