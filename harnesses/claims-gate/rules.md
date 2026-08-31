# Rule snippet for `CLAUDE.md`

Add this section to the project's `CLAUDE.md`. It is context the agent needs to have
without being asked — it explains what `claims-report.md` is when one is encountered, and
why a merge was refused.

The hook enforces the gate; this rule keeps the agent from being surprised by it.

---

## The claims gate

Every closing cycle carries `openspec/changes/<cycle>/claims-report.md`: one row per
verifiable claim the cycle makes about this codebase, each `CONFIRMED`, `REFUTED`, or
`UNVERIFIABLE` and accepted on the record. It is produced by the `claims-gate` skill and
archived with the cycle.

A `PreToolUse` hook refuses `gh pr merge` while a cycle that has reached verify or archive
has no report, a report whose `Verified revision` is stale, or any refuted or
unaccepted-unverifiable claim. Stale means the recorded revision cannot be resolved, or a
file outside the cycle's own folder changed between it and `HEAD` — being merely *behind*
`HEAD` is fine, because the commit that adds a report can never contain its own sha.
Cycles still in planning are not gated.
**Do not work around a refusal** — it is reporting a false statement that is still written
down. Fix the claim or fix the code, then re-run the gate.

The rule underneath it applies whether or not the gate is running: **a claim about this
repository is proven by reading the cited lines or running the command, never by finding
it plausible.** A verify report is a claim. A ticked checkbox is a claim. "This already
works" is a claim. A cycle was once archived carrying three false ones because each of
them read as reasonable and nobody checked.

For test claims specifically, mutate before trusting: a test never seen fail is not
evidence that it detects anything. See the Testing section above.
