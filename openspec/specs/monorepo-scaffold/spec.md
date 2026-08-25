# Delta Spec: monorepo-scaffold

New capability (greenfield, no prior spec).

## ADDED Requirements

### Requirement: pnpm Workspace Layout
The system MUST provide a pnpm workspace with `apps/api`, `apps/web`, and root-level shared tooling config.

#### Scenario: Clean install and test
- GIVEN a fresh checkout
- WHEN running `pnpm install && pnpm -r test`
- THEN all workspace packages install and their test suites pass

### Requirement: Node Version Pinning
The system MUST pin Node 22 LTS via `.nvmrc` and `package.json` `engines`.

#### Scenario: Wrong Node version rejected
- GIVEN a Node version outside the pinned range
- WHEN running any workspace script
- THEN the engines check MUST fail with a clear version mismatch error

### Requirement: Lint/Format Tooling
The system MUST use Biome for lint and format across `apps/api` and `apps/web`.

#### Scenario: Lint catches violations
- GIVEN a file with a Biome-flagged style violation
- WHEN running the lint script
- THEN the command exits non-zero and reports the violation

### Requirement: CI Pipeline
The system MUST run a GitHub Actions workflow on push executing lint, typecheck, and test.

#### Scenario: CI fails on broken code
- GIVEN a push containing a failing test
- WHEN CI runs
- THEN the workflow run fails and blocks the merge signal

### Requirement: Repository Initialization
The system MUST initialize git, provide `.gitignore`, and create a private GitHub repository under the user's personal account.

#### Scenario: Repo created private
- GIVEN the foundation setup is complete
- WHEN the GitHub repository is created
- THEN it MUST be private and owned by the user's personal account
