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
        return (
            "{0} was verified against `{1}`, but HEAD is `{2}`.\n"
            "  The report is stale: the code moved after the claims were proven.\n"
            "  Re-run the claims-gate skill over the current revision."
        ).format(rel, recorded[:12], head[:12])

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

    reasons = [r for r in (inspect(root, c, head_sha(root)) for c in cycles) if r]
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
