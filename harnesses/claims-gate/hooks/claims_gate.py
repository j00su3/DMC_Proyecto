#!/usr/bin/env python
"""PreToolUse hook: refuse `gh pr merge` while a cycle still has unproven claims.

Reads the PreToolUse payload on stdin. Stays silent (exit 0) for every tool call
that is not a `gh pr merge`, so it costs nothing on ordinary work.

Exit codes follow the PreToolUse contract:
  0 - allow the tool call
  2 - block it; stderr is fed back to the agent as the reason

Any unexpected internal failure exits 0. A gate that crashes must not become a
gate that blocks every merge in the repository — it degrades to absent, loudly
on stderr, and the ordinary review path still applies.
"""

import json
import os
import re
import shlex
import subprocess
import sys

CHANGES_DIR = os.path.join("openspec", "changes")
REPORT_NAME = "claims-report.md"

# The report records the revision it was verified against. A report written
# three commits ago describes code that no longer exists.
REVISION_RE = re.compile(r"^\*\*Verified revision:\*\*\s*`?([0-9a-f]{7,40})`?", re.M)
VERDICT_RE = re.compile(r"\|\s*(CONFIRMED|REFUTED|UNVERIFIABLE)\s*\|", re.I)
ACCEPTED_RE = re.compile(r"^\*\*Accepted unverifiable:\*\*\s*(\d+)", re.M)


def repo_root(start):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def head_sha(root):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def code_moved_since(root, recorded, cycle):
    """Files outside the cycle's own folder that changed since `recorded`.

    The guarantee this gate owes is that a report never describes code that
    has since moved. Demanding `Verified revision == HEAD` is a stricter
    reading than that, and an unsatisfiable one: the commit that introduces
    the report changes the very sha the report would have to contain, so no
    amend can ever converge. A cycle whose closing commit carries its own
    report could never pass.

    So the real question is not "is this the tip?" but "has anything the
    claims could be about changed since?". A commit that only touches
    `openspec/changes/<cycle>/` — the report itself, tasks.md, the verify
    report — moves no code and invalidates no claim. Anything else does.

    Returns a sorted list of offending paths, or None when the recorded
    revision cannot be resolved at all (an unknown sha proves nothing, and is
    treated as stale by the caller).
    """
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "{0}..HEAD".format(recorded)],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None

    prefix = "{0}/{1}/".format(CHANGES_DIR.replace("\\", "/"), cycle)
    offenders = set()
    for line in out.stdout.splitlines():
        path = line.strip().replace("\\", "/")
        if path and not path.startswith(prefix):
            offenders.add(path)
    return sorted(offenders)


# A cycle that has reached verify or archive is closing, and its claims are about
# code that now exists. A cycle still carrying only proposal/spec/design/tasks is
# planning: its claims describe intent, and there is nothing yet to check them
# against. This gate is "before closing", not "while anything is open".
CLOSING_MARKERS = ("verify-report.md", "archive-report.md")


def closing_cycles(root):
    """Open cycles that have reached the verify or archive phase."""
    base = os.path.join(root, CHANGES_DIR)
    if not os.path.isdir(base):
        return []
    found = []
    for name in sorted(os.listdir(base)):
        if name == "archive":
            continue
        path = os.path.join(base, name)
        if not os.path.isdir(path):
            continue
        if any(os.path.isfile(os.path.join(path, m)) for m in CLOSING_MARKERS):
            found.append(name)
    return found


# Flags to `gh pr merge` that consume the next token as a value, so that
# token must not be mistaken for the PR selector (number, URL, or branch).
# Every value-taking flag `gh pr merge --help` lists, including the
# inherited `-R`. A missing entry is not cosmetic: its value would be read
# as the selector, `gh pr view <that value>` would fail, and the gate would
# fall back to checking every closing cycle.
MERGE_VALUE_FLAGS = {
    "-R", "--repo",
    "-t", "--subject",
    "-b", "--body",
    "-F", "--body-file",
    "-A", "--author-email",
    "--match-head-commit",
}

# The subset of the above that selects which repository the merge acts on.
# `pr view` must be pointed at the same one, or it resolves a local PR that
# merely shares a number with the real target.
MERGE_REPO_FLAGS = {"-R", "--repo"}


def merge_target(command):
    """`(selector, repo)` for the `gh pr merge` in `command`.

    `selector` is the PR number/url/branch argument, or None - which also
    covers the no-argument form, where `gh` resolves the PR for the current
    branch, same as passing nothing to `pr view` below. `repo` is the
    `-R`/`--repo` value when one is given, so a cross-repo merge is not
    matched against a same-numbered PR in this checkout.
    """
    match = re.search(r"\bgh\s+pr\s+merge\b", command)
    if not match:
        return None, None
    try:
        tokens = shlex.split(command[match.end():])
    except ValueError:
        return None, None
    selector = None
    repo = None
    pending = None
    for token in tokens:
        if pending:
            if pending in MERGE_REPO_FLAGS:
                repo = token
            pending = None
            continue
        if token in MERGE_VALUE_FLAGS:
            pending = token
            continue
        if token.startswith("-"):
            continue
        if selector is None:
            selector = token
    return selector, repo


def pr_head_ref(root, selector, repo=None):
    """The head branch name of the PR `gh pr merge` would act on, or None
    when it cannot be resolved (no `gh`, no auth, no network, bad selector).
    """
    args = ["gh", "pr", "view"]
    if selector:
        args.append(selector)
    if repo:
        args += ["--repo", repo]
    args += ["--json", "headRefName", "-q", ".headRefName"]
    try:
        out = subprocess.run(
            args,
            cwd=root,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None
    ref = out.stdout.strip()
    return ref or None


def cycles_relevant_to(cycles, head_ref):
    """Narrow `cycles` to the ones the PR's branch actually references.

    Branch names in this repo carry their cycle's slug by convention -
    verified against every merged PR in this project's history at the time
    this was written: `feat/motor-alertas-pr1-foundation`,
    `docs/archive-reportes`, `feat/dashboard-kpis-backend` and every other
    PR belonging to a cycle contain that cycle's `openspec/changes/` folder
    name; unrelated PRs like `fix/backup-exclude-drizzle-schema` contain no
    cycle slug at all. This is why a closing cycle with unproven claims no
    longer blocks merges of PRs that have nothing to do with it.

    Returns None, not an empty list, when `head_ref` is unknown. The caller
    must then fall back to checking every closing cycle rather than skip the
    check: "can't tell if it's related" is not evidence that it isn't, and
    this gate does not treat uncertainty as a pass (see the stale-revision
    handling in `inspect`, which fails the same way for the same reason).
    """
    if not head_ref:
        return None
    lowered = head_ref.lower()
    return [c for c in cycles if c.lower() in lowered]


def inspect(root, cycle, head):
    """Return a blocking reason for this cycle, or None when it passes."""
    path = os.path.join(root, CHANGES_DIR, cycle, REPORT_NAME)
    rel = os.path.join(CHANGES_DIR, cycle, REPORT_NAME).replace("\\", "/")

    if not os.path.isfile(path):
        return (
            "{0} does not exist.\n"
            "  The cycle `{1}` has reached verify or archive and no claim in it has\n"
            "  been checked. Run the claims-gate skill over this cycle before merging."
        ).format(rel, cycle)

    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        return "{0} could not be read: {1}".format(rel, exc)

    revision = REVISION_RE.search(text)
    if not revision:
        return (
            "{0} carries no `**Verified revision:**` line, so there is no way to "
            "tell which code it was checked against."
        ).format(rel)

    recorded = revision.group(1)
    if head and not (head.startswith(recorded) or recorded.startswith(head)):
        moved = code_moved_since(root, recorded, cycle)
        if moved is None:
            return (
                "{0} was verified against `{1}`, which cannot be resolved in this\n"
                "  repository, so there is no way to tell what the claims describe.\n"
                "  Re-run the claims-gate skill over the current revision."
            ).format(rel, recorded[:12])
        if moved:
            shown = ", ".join(moved[:5])
            more = "" if len(moved) <= 5 else " (+{0} more)".format(len(moved) - 5)
            return (
                "{0} was verified against `{1}`, but HEAD is `{2}` and these files\n"
                "  changed in between: {3}{4}.\n"
                "  The report is stale: the code moved after the claims were proven.\n"
                "  Re-run the claims-gate skill over the current revision."
            ).format(rel, recorded[:12], head[:12], shown, more)
        # Behind HEAD, but every commit since touches only this cycle's own
        # folder. No claim can have been invalidated, so the report stands.

    verdicts = [v.upper() for v in VERDICT_RE.findall(text)]
    if not verdicts:
        return (
            "{0} contains no verdict rows. An empty report is not a passing report."
        ).format(rel)

    refuted = verdicts.count("REFUTED")
    if refuted:
        return (
            "{0} holds {1} REFUTED claim(s).\n"
            "  A refuted claim is a false statement about this codebase, still written down.\n"
            "  Correct the claim or correct the code, then re-run the gate."
        ).format(rel, refuted)

    unverifiable = verdicts.count("UNVERIFIABLE")
    if unverifiable:
        accepted = ACCEPTED_RE.search(text)
        count = int(accepted.group(1)) if accepted else 0
        if count < unverifiable:
            return (
                "{0} holds {1} UNVERIFIABLE claim(s) but only {2} are recorded as\n"
                "  accepted. Add `**Accepted unverifiable:** {1}` once the owner has\n"
                "  decided to ship them unproven. An unverifiable claim may pass, but\n"
                "  only on purpose and on the record."
            ).format(rel, unverifiable, count)

    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    if payload.get("tool_name") != "Bash":
        return 0

    command = (payload.get("tool_input") or {}).get("command") or ""
    if not re.search(r"\bgh\s+pr\s+merge\b", command):
        return 0

    start = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    root = repo_root(start)
    if not root:
        return 0

    cycles = closing_cycles(root)
    if not cycles:
        # Nothing is closing, so there is nothing this gate is responsible for.
        return 0

    selector, repo = merge_target(command)
    relevant = cycles_relevant_to(cycles, pr_head_ref(root, selector, repo))
    if relevant is None:
        # Could not resolve which branch this PR merges. Uncertain is not
        # the same as unrelated - check every closing cycle, same as before
        # this branch-scoping existed.
        relevant = cycles

    reasons = [r for r in (inspect(root, c, head_sha(root)) for c in relevant) if r]
    if not reasons:
        return 0

    sys.stderr.write(
        "claims-gate: refusing this merge - unproven claims remain.\n\n"
        + "\n\n".join("- " + r for r in reasons)
        + "\n\nEvery claim in a closing cycle must be CONFIRMED, or REFUTED and fixed,\n"
        "or UNVERIFIABLE and explicitly accepted. This gate exists because a cycle\n"
        "was once archived carrying three false statements that nobody had checked.\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # never let a broken gate block every merge
        sys.stderr.write("claims-gate: internal error, allowing the call: {0}\n".format(exc))
        sys.exit(0)
