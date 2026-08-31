---
name: claims-gate
description: Proves or kills every verifiable claim a closing SDD cycle makes about the InvenTienda codebase, before the cycle is merged and archived. Extracts claims verbatim from the cycle's reports, its tasks.md checkboxes, the PR body and commits, and the standing reports under docs/, then confirms each one by reading the cited lines or running the command — never by reasoning about it. Writes claims-report.md into the cycle folder and blocks the merge on any refuted or silently unproven claim. Use when closing, archiving or merging an SDD cycle, when a verify or archive report needs auditing, or when any report's claims must be proven before they are believed.
---

# Claims Gate

## Goal

Take every verifiable claim a closing cycle makes about this codebase and return it
**proven, killed, or explicitly labelled unprovable**. Nothing in between.

A claim is any statement of fact about the repository: *"the lockout check runs before
password verification"*, *"task 4.2 is complete"*, *"this has no performance impact"*,
*"the mutated index failed three tests"*. A verdict reached by reading the claim and
finding it plausible is not a verdict. It is the same guess, restated with more
confidence.

## Why this exists

This is not a hypothetical control. Each of these happened in this repository:

- The archive report for cycle `gestion-proveedores` shipped carrying **three false
  statements**. It reported `PASS WITH WARNINGS` in five places while its own
  `verify-report.md:219` said `passed`. It described a mutation experiment as
  hypothetical that had actually been run live, and got its result wrong. It carried an
  open question asserting a wire code was "fully Spanish" that `errors.ts:169` shows is
  English — the question had been written before the rename and never re-read.
- A claim that some coverage gaps "fix themselves" was made from *reading* a `!==`
  operator, with nothing executed. The owner refused it with a single word —
  *"compruébalo"* — and the probe that followed proved the behaviour was correct but the
  coverage was not.
- Three analysis passes each filed one leg of the same exploitable chain at a different
  severity. No single report ranked it critical, because no single report could see all
  three legs.

None of these were caused by dishonesty. All three were caused by nobody checking.

## Non-negotiables

- **Never edit code, tests, specs or reports to make a claim come true.** This skill
  produces verdicts. Fixing what a verdict exposes is separate work, done deliberately,
  after the report is written.
- **Never mark a claim CONFIRMED without having actually read the cited lines or run the
  command.** If the evidence was not obtained, the verdict is UNVERIFIABLE. Not
  CONFIRMED-probably.
- **Never read, write, move or reference any `.env*` file in any tool call.** A
  permission rule denies them and a denied call wastes a turn. Prove absence of committed
  secrets with `git ls-files` and `.gitignore`, never with the files themselves.
- **Never reduce test output to a count with `rg`/`head`.** Write the full output to a
  file and search the file. A filtered pass count hides which test passed.

## Environment

```bash
export PATH="/c/Users/User/.corepack-shims:$PATH"   # pnpm is not on the PowerShell PATH
```

Integration tests need the Docker Postgres container (`pnpm db:up`) and are excluded from
the default run — `pnpm test:integration` is separate. Their `DATABASE_URL` comes from
`apps/api/vitest.integration.config.ts`, not from an env file. `jq` is **not installed on
this machine**; use Python for JSON.

## Procedure

Run these in order. Steps 3, 4 and 5 are the ones that do the actual work; the rest exist
so the work lands on the right claims.

### 1. Extract the claim VERBATIM

Copy the sentence as written. Never paraphrase — paraphrasing quietly repairs a claim's
weakest word, and the weakest word is usually where the falsehood lives.

Read all four sources:

| Source | What to extract |
| --- | --- |
| `openspec/changes/<cycle>/verify-report.md`, `archive-report.md` | Every gate result, finding, severity and open question |
| `openspec/changes/<cycle>/tasks.md` | Every `[x]` — each one claims "this is done" |
| The PR body and the commit messages | Every promise made to whoever reviews it |
| `docs/SECURITY.md`, `docs/DRIFT.md`, `docs/DEPLOY-PLAN.md` | Only claims whose cited files this cycle touched |

The `docs/` reports age differently from the rest: nothing in a cycle invalidates them,
but a citation to `service.ts:55` stops being true the moment someone inserts a line above
it. Re-check only the citations pointing into files this cycle's diff touched.

### 2. Classify how it can be proven

Three buckets, decided before any checking starts:

- **Against code** — resolvable by reading a file at a line.
- **Against execution** — needs a command actually run: a test suite, a query, a request.
- **Neither** — subjective, about the future, or about something outside this repository
  ("no performance impact", "the reviewer will find this clear"). These are legitimate
  statements; they are simply not claims this gate can settle.

### 3. Code claims: read the lines and the logic around them

Open the file and read the cited region **plus its surroundings**. Do not grep for a
keyword and treat a hit as proof.

The reason is concrete. In `apps/api/src/auth/service.ts`, both real defects are the
**order of the guard clauses** — the lockout check sits above `verifyPassword`, and the
not-found branch sits above the lockout branch. Every individual line is correct. A grep
for `accountLocked` confirms it is called and proves nothing at all.

### 4. Execution claims: run it

Run the command. Do not reason about what it would print.

Capture the complete output to a file and read the file. If the claim concerns something
`console.log` reports, remember that plain `vitest run` swallows it — use
`--reporter=verbose`.

For a claim about the database, assert against the database. A refusal that returns 403
and still writes the row passes a status-only assertion.

### 5. Test claims: mutate before trusting

**A test you have never seen fail is not evidence.** To prove a test covers what a report
says it covers, break the thing on purpose and watch that specific test go red.

This step separates real coverage from layer formality, and the distinction is invisible
without it. In this repository two findings looked identical in a verify report. Mutating
the service to swallow a collision failed exactly one new test while twenty-one repository
tests stayed green — real coverage. Mutating the unique index to add `WHERE activo` failed
three tests, two of which already existed — formality.

**Always revert the mutation, and verify the revert.** Do not assume it.

### 6. One verdict per claim, and unverifiable stays visible

- **CONFIRMED** — evidence obtained, claim holds.
- **REFUTED** — evidence obtained, claim is false.
- **UNVERIFIABLE** — could not be settled from this repository, and *why* is recorded.

An UNVERIFIABLE claim is never silently dropped, and never quietly upgraded. It may ship,
but only when the owner accepts it on the record (see the report format below). Confidence
is not a verdict.

### 7. Two artifacts that contradict each other fail automatically

When two documents in the cycle disagree, at most one is right and no code needs to be
read to know it. Record both statements, both locations, and mark the pair REFUTED.

This is the step that would have caught cycle #4 on its own: `verify-report.md` said
`passed`, `archive-report.md` said `PASS WITH WARNINGS`. The contradiction was fully
visible inside the cycle folder.

## Delegation

The author of a claim is its worst verifier. Whoever wrote the report already believes it,
already knows which parts were reasoned rather than run, and will unconsciously protect
them.

Steps 3–5 therefore go to the **`claims-verifier`** sub-agent, which receives the extracted
claims and nothing else — no report, no rationale, no author's summary. It sees the
statements cold and checks them against the repository.

Delegate one batch. Do not send it the conclusion you expect.

## Output

Write `openspec/changes/<cycle>/claims-report.md`. English, like everything else under
`openspec/`.

```markdown
# Claims Report: <cycle>

**Verified revision:** `<full git HEAD sha>`
**Verified on:** <YYYY-MM-DD>
**Sources:** verify-report.md, archive-report.md, tasks.md, PR #NN, docs/SECURITY.md

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "the lockout check runs before password verification" | verify-report.md:88 | read apps/api/src/auth/service.ts:55-68 | CONFIRMED |
| 2 | "task 4.2 complete" | tasks.md:61 | no commit touches the named file | REFUTED |
| 3 | "no performance impact" | PR #57 body | not measurable from this repository | UNVERIFIABLE |

**Confirmed:** 10 · **Refuted:** 1 · **Unverifiable:** 1
**Accepted unverifiable:** 1

## Refuted claims

### 2 — "task 4.2 complete"
Written at `tasks.md:61`. `git log -- apps/api/src/productos/service.ts` shows no commit
in this cycle. Either the checkbox is wrong or the work is missing.
```

The **Verified revision** line is load-bearing: the hook refuses a merge when the report
describes code that has since moved. Record the full sha of the revision you actually
verified against.

It does not have to be `HEAD`, and it cannot be: writing a sha into the report changes the
report, which changes the sha, so a commit can never contain its own. Verify at a revision,
then commit the report on top of it — the hook accepts a recorded revision behind `HEAD` as
long as nothing outside `openspec/changes/<cycle>/` changed in between. Put any code or
harness change in the commit you verify *at*, never in one after it.

**Accepted unverifiable** must equal the UNVERIFIABLE count before the gate passes. It is
the owner's signature that those claims ship unproven, on purpose. Never write it on the
owner's behalf — ask, and if the answer has not come back, leave it absent and let the
gate hold.

Then print a short verdict to the terminal: counts, and every refuted claim in one line
each.

## What the gate refuses

The hook blocks `gh pr merge` while a **closing** cycle has any of the following. A
cycle counts as closing once it carries a `verify-report.md` or `archive-report.md`; one
still holding only proposal, spec, design and tasks is planning, and its claims describe
intent rather than code that exists, so it is not gated.

- no `claims-report.md` at all;
- a report whose `Verified revision` is stale — either it cannot be resolved, or a file
  outside `openspec/changes/<cycle>/` changed between it and `HEAD`, which means code moved
  after the claims were proven. Being *behind* `HEAD` is not itself stale: the commit that
  introduces the report cannot record its own sha, so a report is allowed to sit one or more
  commits back as long as every commit since touches only the cycle's own folder;
- a report with no verdict rows (empty is not passing);
- one or more REFUTED claims;
- UNVERIFIABLE claims the owner has not accepted on the record.

The gate never blocks on a hook failure. If it breaks, it writes to stderr and allows the
call — a gate that crashes must not become a gate that blocks every merge.
