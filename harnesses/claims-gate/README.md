# Claims Gate

A harness that refuses to let an SDD cycle merge while it still asserts things about this
codebase that nobody has checked.

## What it does

When a cycle closes, its artifacts are full of claims: gate results in `verify-report.md`,
`[x]` checkboxes in `tasks.md`, promises in the PR body, `file:line` citations in the
standing reports under `docs/`. Each one is a statement of fact about the repository, and
each one is believed by whoever reads it next.

This harness extracts those claims verbatim, proves or kills each one against the actual
code — by reading the cited lines or running the command, never by reasoning about it —
writes the results to `openspec/changes/<cycle>/claims-report.md`, and blocks the merge if
anything is refuted or quietly unproven.

## Why it exists

The archive report for cycle `gestion-proveedores` shipped carrying **three false
statements**. It reported `PASS WITH WARNINGS` in five places while its own
`verify-report.md:219` said `passed`. It described a mutation experiment as hypothetical
that had actually been run, and got its result wrong. It carried an open question about a
wire code that a rename had made false weeks earlier.

Not one of those was dishonesty. All three were nobody checking.

The gate encodes the correction the project owner had already been applying by hand — one
word, *"compruébalo"* — into something that runs whether or not anyone remembers to
apply it.

## The pieces

| Piece | File | What it is for |
| --- | --- | --- |
| Skill | `SKILL.md` | The procedure: extract verbatim, classify, read the lines, run the command, mutate before trusting a test, one verdict each, contradictions fail automatically. Invoked as `claims-gate`. |
| Sub-agent | `agents/claims-verifier.md` | Does the checking **cold** — receives the claims with no report, no rationale and no author summary. The author of a claim is its worst verifier, so the verifier is never the author. |
| Hook | `hooks/claims_gate.py` | A `PreToolUse` hook that refuses `gh pr merge` while a closing cycle has unproven claims. Silent on every other tool call. |
| Rule | `rules.md` | A `CLAUDE.md` section so the agent knows what a `claims-report.md` is and why a merge was refused. |

Three mechanisms rather than one, because they do different jobs: the skill is invoked, the
rule is always in context, and the hook **executes** — an instruction in a rules file can
be read and ignored, which is precisely how the original failure happened.

## What the gate refuses

`gh pr merge` is blocked while a **closing** cycle under `openspec/changes/` has any of
the following. A cycle counts as closing once it carries a `verify-report.md` or
`archive-report.md` — a cycle still in planning is not gated, because its claims are about
intent, not about code that exists yet:

- no `claims-report.md`;
- a `Verified revision` that is not `HEAD` — the report is stale, the code moved under it;
- no verdict rows at all (an empty report is not a passing report);
- one or more `REFUTED` claims;
- `UNVERIFIABLE` claims the owner has not accepted on the record.

An unverifiable claim can ship. It just cannot ship silently: the report needs an explicit
`**Accepted unverifiable:** N` line matching the count, written by the owner, not by the
agent.

If the hook itself fails it writes to stderr and **allows** the call. A gate that crashes
must not become a gate that blocks every merge in the repository.

## Installing it on another machine

Everything below is already active in this checkout. A teammate cloning the repository
needs these four steps.

**1. Install the skill.** Copy the skill so the agent discovers it:

```bash
mkdir -p .claude/skills/claims-gate
cp harnesses/claims-gate/SKILL.md .claude/skills/claims-gate/SKILL.md
```

`.claude/skills/` is gitignored in this repository (see `.gitignore` — `npx skills add`
writes absolute symlinks into one machine's checkout), so this copy is per-machine by
design. `harnesses/claims-gate/` is the versioned source of truth.

**2. Register the sub-agent.** `.claude/agents/` is versioned, so `claims-verifier.md`
should already be present after cloning. If it is not:

```bash
mkdir -p .claude/agents
cp harnesses/claims-gate/agents/claims-verifier.md .claude/agents/
```

**3. Register the hook.** Merge this into `.claude/settings.json`, keeping any hooks
already there:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python \"${CLAUDE_PROJECT_DIR}/harnesses/claims-gate/hooks/claims_gate.py\""
          }
        ]
      }
    ]
  }
}
```

The hook needs **Python 3** on the PATH. It deliberately does not use `jq`, which is not
installed on the original author's machine — a dependency that fails silently is worse
than none, and one silent `jq` failure had already cost a CI monitor in this project.

**4. Add the rule.** Append the section in `rules.md` to `CLAUDE.md`.

## Verifying it works

With an open cycle that has no report yet, the hook should refuse:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 99 --merge"}}' \
  | python harnesses/claims-gate/hooks/claims_gate.py; echo "exit: $?"
```

Expect exit `2` and an explanation on stderr. On any other command it must exit `0`
silently:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | python harnesses/claims-gate/hooks/claims_gate.py; echo "exit: $?"
```

## Scope

One concern: **claims about this codebase, proven before a cycle closes.** It does not
review code quality, does not audit security, and does not check the deploy — those are
`security-pass`, `auditar-drift` and `deploy-pass`, which are separate passes producing
separate reports. If a new recurring task needs a harness, build another one rather than
widening this.
