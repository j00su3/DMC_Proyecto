# Delta Spec: migrations-infra

New capability (greenfield, no prior spec).

## ADDED Requirements

### Requirement: DATABASE_URL-Driven Migrations
Drizzle Kit migrations MUST run using a single `DATABASE_URL` env var, working identically against local Docker Postgres and Neon.

#### Scenario: Migrate against local Postgres
- GIVEN `DATABASE_URL` points to local Docker Postgres
- WHEN running the migration command
- THEN the schema applies without manual intervention

#### Scenario: Migrate against Neon
- GIVEN `DATABASE_URL` points to a Neon database
- WHEN running the same migration command
- THEN the schema applies identically to the local run

### Requirement: Local Dev Postgres via Docker Compose
Docker Compose MUST provide a local Postgres instance for development only; it MUST NOT be used for production.

#### Scenario: Local dev up
- GIVEN `docker compose up` for the Postgres service
- WHEN the API connects using the local `DATABASE_URL`
- THEN it connects successfully without touching any managed database
