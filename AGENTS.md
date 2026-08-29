# AGENTS.md — InvenTienda

**Read `CLAUDE.md` in this same directory before writing any code.** It is the real working
document for this repository and it is not duplicated here — everything in it was learned by
breaking something first, and almost none of it is inferable from the source.

This file exists because agents that look for `AGENTS.md` would otherwise start blind.

## The four things that cost the most if you miss them

Everything below is expanded in `CLAUDE.md`. These are repeated here only because getting them
wrong is expensive and the mistake is silent.

1. **Never read, write, move or reference any `.env*` file in any tool call.** A permission rule
   denies them. To prove no secret is committed, use `git ls-files` and `.gitignore`, never the
   files themselves. A change needing a new environment variable is reported as a manual step for
   the owner.
2. **`docs/TECH-DESIGNv2.md` is authoritative. `docs/TECH-DESIGN.md` is superseded** and says so in
   a banner at its top. A planning cycle was nearly built against the stale document.
3. **`pnpm` is not on the PowerShell PATH.** In bash: `export PATH="/c/Users/User/.corepack-shims:$PATH"`.
   `jq` is **not installed at all** — use Python for JSON. A silent `jq` failure once cost a CI
   watcher that timed out emitting nothing.
4. **The audit compile gate is `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`**
   (`apps/api/src/auditoria/service.ts:8`), not the `entidadAuditoria` pgEnum. The enum already
   lists `productos`, so it looks permissive; the application still will not build until
   `apps/api/src/auditoria/fields.ts` gains the entry.

## The claims gate does not run here

`harnesses/claims-gate/` holds a harness that refuses to let an SDD cycle merge while it still
asserts unverified things about this codebase. **Its hook is wired through
`.claude/settings.json`, which only Claude Code reads.** Under any other runtime the gate is
present in the repository and silent.

So the discipline it enforces has to be applied by hand here:

- A claim about this repository is proven by **reading the cited lines or running the command**,
  never by finding it plausible. A verify report is a claim. A ticked checkbox is a claim. "This
  already works" is a claim.
- **Mutate before trusting a test.** A test you have never seen fail is not evidence that it
  detects anything.
- Two artifacts in a cycle that contradict each other fail automatically — at most one is right,
  and no code needs reading to know it.

Read `harnesses/claims-gate/SKILL.md` for the full procedure and the incidents behind it. Porting
the hook to another runtime's plugin system is unfinished work, not a decision against it.

## Where things live

| Path | What |
| --- | --- |
| `CLAUDE.md` | The working knowledge. Start here. |
| `docs/` | PRD, technical design v2, ADRs, backlog, adversarial review, and the security, drift and deploy reports. Spanish. |
| `openspec/` | SDD artifacts — `specs/` promoted, `changes/` in flight, `changes/archive/` closed |
| `harnesses/` | Owner-built harnesses. Each carries its own README with install steps. |
| `apps/api` | Fastify 5 + Drizzle over PostgreSQL 16 |
| `apps/web` | React 19 SPA — Vite, TanStack Query + Router |

`docs/BACKLOG.md` is the source of truth for what is done, in flight and pending.

## Language

Code, comments, commit messages, PR bodies and specs are **English**. `docs/` is **Spanish**.
Conventional commits, and **no AI attribution or `Co-Authored-By` trailers**.
