#!/usr/bin/env python
"""Tests for the claims-gate PreToolUse hook.

Run from the repository root:

    python -m unittest discover -s harnesses/claims-gate/hooks -p 'test_*.py'

Standard-library `unittest` on purpose. This hook is the only Python in a
pnpm workspace, and a suite that needs its own toolchain installed first is
a suite nobody runs. No third-party dependency, no config file, no plugin.

Three parsing defects reached `main` in a gate whose entire job is refusing
to trust unproven things. That is the reason this file exists, so the two
classes covering `merge_target` and `pr_head_ref` carry the regressions
verbatim: a cross-repo merge resolving a local PR, and value-taking flags
whose argument was read as the PR selector.

The git-backed tests build real repositories and run real `git` against
them. `gh` is never called: `pr_head_ref` is tested by asserting the exact
argv it builds, which is where the cross-repo defect actually lived, and
the end-to-end tests stub it out.
"""

import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_hook():
    """Import `claims_gate.py` by path, so the suite runs from any cwd."""
    path = os.path.join(_HERE, "claims_gate.py")
    spec = importlib.util.spec_from_file_location("claims_gate_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cg = _load_hook()


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _force_remove(func, path, _exc):
    """git leaves objects read-only; Windows refuses to unlink those."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _rmtree(path):
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_force_remove)
    else:
        shutil.rmtree(path, onerror=_force_remove)


class TempRepo(object):
    """A real git repository in a temp directory.

    Real git, not a stub: `code_moved_since` and `head_sha` are thin wrappers
    over `git` output, so stubbing git would leave the only thing worth
    testing untested.
    """

    def __init__(self):
        self.root = None

    def __enter__(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="claims-gate-test-"))
        self.git("init")
        # Local identity, so the suite does not depend on the developer's
        # global git config being set.
        self.git("config", "user.email", "tests@example.invalid")
        self.git("config", "user.name", "claims-gate tests")
        self.git("config", "commit.gpgsign", "false")
        return self

    def __exit__(self, *_exc):
        _rmtree(self.root)
        return False

    def git(self, *args):
        out = subprocess.run(
            ["git"] + list(args),
            cwd=self.root,
            capture_output=True,
            text=True,
        )
        if out.returncode != 0:
            raise AssertionError(
                "git {0} failed: {1}".format(" ".join(args), out.stderr.strip())
            )
        return out.stdout.strip()

    def write(self, relpath, text):
        full = os.path.join(self.root, relpath.replace("/", os.sep))
        parent = os.path.dirname(full)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def head(self):
        return self.git("rev-parse", "HEAD")


def report(revision, rows=(("a claim", "CONFIRMED"),), accepted=None):
    """A `claims-report.md` body in the shape the hook parses."""
    text = "# Claims report\n\n**Verified revision:** `{0}`\n\n".format(revision)
    text += "| Claim | Verdict |\n| --- | --- |\n"
    for claim, verdict in rows:
        text += "| {0} | {1} |\n".format(claim, verdict)
    if accepted is not None:
        text += "\n**Accepted unverifiable:** {0}\n".format(accepted)
    return text


def closing_cycle(repo, cycle, report_text=None):
    """Put `cycle` in the verify phase, optionally with a claims report."""
    repo.write(
        "openspec/changes/{0}/verify-report.md".format(cycle), "# verify\n\npassed\n"
    )
    if report_text is not None:
        repo.write("openspec/changes/{0}/claims-report.md".format(cycle), report_text)


class FakeRun(object):
    """Stands in for `subprocess.run`, recording the argv it was handed."""

    def __init__(self, stdout="", returncode=0, raises=None):
        self.stdout = stdout
        self.returncode = returncode
        self.raises = raises
        self.args = None
        self.kwargs = None

    def __call__(self, args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        if self.raises is not None:
            raise self.raises
        return subprocess.CompletedProcess(args, self.returncode, self.stdout, "")


# --------------------------------------------------------------------------
# merge_target - which PR, and in which repository
# --------------------------------------------------------------------------


class MergeTargetTests(unittest.TestCase):
    def assertTarget(self, command, selector, repo):
        self.assertEqual(cg.merge_target(command), (selector, repo))

    def test_no_argument_form_has_no_selector(self):
        # `gh` resolves the current branch's PR, same as `pr view` with none.
        self.assertTarget("gh pr merge --squash --delete-branch", None, None)

    def test_plain_number(self):
        self.assertTarget("gh pr merge 182 --squash", "182", None)

    def test_url_selector(self):
        self.assertTarget(
            "gh pr merge https://github.com/o/r/pull/5 -s",
            "https://github.com/o/r/pull/5",
            None,
        )

    def test_branch_selector(self):
        self.assertTarget("gh pr merge feat/motor-alertas -m", "feat/motor-alertas", None)

    def test_repo_flag_is_captured_before_the_selector(self):
        # The regression: without this the merge targets another repository
        # while the gate resolves a same-numbered PR in this checkout.
        self.assertTarget("gh pr merge -R owner/other 10", "10", "owner/other")

    def test_repo_flag_is_captured_after_the_selector(self):
        self.assertTarget("gh pr merge 10 --repo owner/other", "10", "owner/other")

    def test_repo_flag_value_is_not_read_as_the_selector(self):
        self.assertTarget("gh pr merge --repo owner/other", None, "owner/other")

    def test_repo_flag_with_equals_is_captured_after_the_selector(self):
        # pflag (gh's flag library) accepts `--flag=value` as well as
        # `--flag value` for any flag, long or short. Skipping the `=` form
        # silently reproduces the cross-repo regression the space form fixes.
        self.assertTarget("gh pr merge 10 --repo=owner/other", "10", "owner/other")

    def test_short_repo_flag_with_equals_is_captured_before_the_selector(self):
        self.assertTarget("gh pr merge -R=owner/other 10", "10", "owner/other")

    def test_non_repo_value_flag_with_equals_is_not_the_selector(self):
        self.assertTarget("gh pr merge --subject=hello 10", "10", None)

    def test_match_head_commit_value_is_not_the_selector(self):
        # `--match-head-commit <SHA>` used to yield the SHA as the selector,
        # `gh pr view <sha>` then failed, and the gate fell back to checking
        # every closing cycle - the exact over-blocking scoping removed.
        self.assertTarget("gh pr merge --match-head-commit deadbeef --squash", None, None)

    def test_match_head_commit_does_not_swallow_a_real_selector(self):
        self.assertTarget("gh pr merge --match-head-commit deadbeef 182", "182", None)

    def test_author_email_value_is_not_the_selector(self):
        self.assertTarget("gh pr merge -A me@example.com --merge", None, None)

    def test_subject_and_body_values_are_not_the_selector(self):
        self.assertTarget("gh pr merge -t 'my subject' -b 'body here' 7", "7", None)

    def test_body_file_value_is_not_the_selector(self):
        self.assertTarget("gh pr merge -F notes.md 7", "7", None)

    def test_every_value_taking_flag_of_gh_pr_merge_is_covered(self):
        # Pinned against `gh pr merge --help`. A flag added here without a
        # matching entry in the hook is the defect this test exists to catch.
        self.assertEqual(
            cg.MERGE_VALUE_FLAGS,
            {
                "-R", "--repo",
                "-t", "--subject",
                "-b", "--body",
                "-F", "--body-file",
                "-A", "--author-email",
                "--match-head-commit",
            },
        )

    def test_boolean_flags_are_skipped(self):
        self.assertTarget("gh pr merge --admin --auto -d -s 9", "9", None)

    def test_first_bare_token_wins(self):
        self.assertTarget("gh pr merge 9 8", "9", None)

    def test_command_without_gh_pr_merge(self):
        self.assertTarget("git status", None, None)

    def test_unbalanced_quotes_do_not_raise(self):
        # shlex.split raises on an unterminated quote; the gate must degrade,
        # not crash. main() then falls back to checking every closing cycle.
        self.assertTarget("gh pr merge -t 'unterminated 10", None, None)


# --------------------------------------------------------------------------
# pr_head_ref - the argv handed to `gh pr view`
# --------------------------------------------------------------------------


class PrHeadRefTests(unittest.TestCase):
    def call(self, selector, repo=None, **fake):
        runner = FakeRun(**fake)
        original = cg.subprocess.run
        cg.subprocess.run = runner
        try:
            return runner, cg.pr_head_ref("/some/root", selector, repo)
        finally:
            cg.subprocess.run = original

    def test_forwards_the_repo_flag(self):
        # The regression, asserted on the argv itself: without `--repo`, this
        # resolves a local PR #10 that has nothing to do with the merge.
        runner, ref = self.call("10", "owner/other", stdout="feat/their-branch\n")
        self.assertEqual(
            runner.args,
            [
                "gh", "pr", "view", "10",
                "--repo", "owner/other",
                "--json", "headRefName",
                "-q", ".headRefName",
            ],
        )
        self.assertEqual(ref, "feat/their-branch")

    def test_omits_the_repo_flag_when_none_was_given(self):
        runner, _ = self.call("10", None, stdout="feat/x\n")
        self.assertNotIn("--repo", runner.args)
        self.assertEqual(runner.args[:4], ["gh", "pr", "view", "10"])

    def test_omits_the_selector_for_the_no_argument_form(self):
        runner, _ = self.call(None, None, stdout="feat/x\n")
        self.assertEqual(
            runner.args,
            ["gh", "pr", "view", "--json", "headRefName", "-q", ".headRefName"],
        )

    def test_runs_in_the_repository_root(self):
        runner, _ = self.call("10", None, stdout="feat/x\n")
        self.assertEqual(runner.kwargs.get("cwd"), "/some/root")

    def test_non_zero_exit_yields_none(self):
        _, ref = self.call("10", None, returncode=1, stdout="")
        self.assertIsNone(ref)

    def test_missing_gh_yields_none(self):
        _, ref = self.call("10", None, raises=OSError("no gh on PATH"))
        self.assertIsNone(ref)

    def test_empty_output_yields_none(self):
        _, ref = self.call("10", None, stdout="   \n")
        self.assertIsNone(ref)


# --------------------------------------------------------------------------
# cycles_relevant_to - branch name to cycle slug
# --------------------------------------------------------------------------


class CyclesRelevantToTests(unittest.TestCase):
    CYCLES = ["motor-alertas", "dashboard-kpis"]

    def test_matches_the_cycle_named_in_the_branch(self):
        self.assertEqual(
            cg.cycles_relevant_to(self.CYCLES, "feat/motor-alertas-pr1-foundation"),
            ["motor-alertas"],
        )

    def test_unrelated_branch_matches_nothing(self):
        self.assertEqual(
            cg.cycles_relevant_to(self.CYCLES, "fix/backup-exclude-drizzle-schema"), []
        )

    def test_matching_is_case_insensitive(self):
        self.assertEqual(
            cg.cycles_relevant_to(self.CYCLES, "FEAT/Motor-Alertas"), ["motor-alertas"]
        )

    def test_a_branch_can_match_more_than_one_cycle(self):
        self.assertEqual(
            cg.cycles_relevant_to(self.CYCLES, "chore/motor-alertas-and-dashboard-kpis"),
            ["motor-alertas", "dashboard-kpis"],
        )

    def test_unknown_branch_is_none_not_empty(self):
        # None and [] must stay distinguishable: [] means "checked, unrelated"
        # and allows the merge, None means "could not tell" and makes the
        # caller check every closing cycle. Collapsing them turns uncertainty
        # into a pass, which is the one thing this gate must never do.
        self.assertIsNone(cg.cycles_relevant_to(self.CYCLES, None))
        self.assertIsNone(cg.cycles_relevant_to(self.CYCLES, ""))


# --------------------------------------------------------------------------
# closing_cycles - which cycles the gate is responsible for
# --------------------------------------------------------------------------


class ClosingCyclesTests(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="claims-gate-cycles-"))
        self.addCleanup(_rmtree, self.root)

    def make(self, relpath, text="x\n"):
        full = os.path.join(self.root, relpath.replace("/", os.sep))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)

    def test_missing_changes_directory(self):
        self.assertEqual(cg.closing_cycles(self.root), [])

    def test_verify_report_closes_a_cycle(self):
        self.make("openspec/changes/motor-alertas/verify-report.md")
        self.assertEqual(cg.closing_cycles(self.root), ["motor-alertas"])

    def test_archive_report_closes_a_cycle(self):
        self.make("openspec/changes/motor-alertas/archive-report.md")
        self.assertEqual(cg.closing_cycles(self.root), ["motor-alertas"])

    def test_planning_cycles_are_not_gated(self):
        # Claims in a proposal describe intent. There is nothing yet to check
        # them against, so the gate is not responsible for them.
        self.make("openspec/changes/planning-only/proposal.md")
        self.make("openspec/changes/planning-only/tasks.md")
        self.assertEqual(cg.closing_cycles(self.root), [])

    def test_the_archive_folder_is_skipped(self):
        self.make("openspec/changes/archive/2026-01-01-old/verify-report.md")
        self.make("openspec/changes/archive/verify-report.md")
        self.assertEqual(cg.closing_cycles(self.root), [])

    def test_loose_files_are_skipped(self):
        self.make("openspec/changes/README.md")
        self.assertEqual(cg.closing_cycles(self.root), [])

    def test_result_is_sorted(self):
        self.make("openspec/changes/zeta/verify-report.md")
        self.make("openspec/changes/alpha/verify-report.md")
        self.assertEqual(cg.closing_cycles(self.root), ["alpha", "zeta"])


# --------------------------------------------------------------------------
# code_moved_since - has anything the claims could be about changed?
# --------------------------------------------------------------------------


class CodeMovedSinceTests(unittest.TestCase):
    def test_commits_touching_only_the_cycle_folder_move_no_code(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")

            repo.write("openspec/changes/cyc/claims-report.md", "# report\n")
            repo.write("openspec/changes/cyc/tasks.md", "- [x] done\n")
            repo.commit("close the cycle")

            self.assertEqual(cg.code_moved_since(repo.root, base, "cyc"), [])

    def test_a_change_outside_the_cycle_folder_is_an_offender(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")

            repo.write("apps/api/src/app.ts", "export const a = 2;\n")
            repo.commit("move the code the claims describe")

            self.assertEqual(
                cg.code_moved_since(repo.root, base, "cyc"), ["apps/api/src/app.ts"]
            )

    def test_another_cycles_folder_is_an_offender(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")

            repo.write("openspec/changes/other/claims-report.md", "# report\n")
            repo.commit("another cycle moved")

            self.assertEqual(
                cg.code_moved_since(repo.root, base, "cyc"),
                ["openspec/changes/other/claims-report.md"],
            )

    def test_offenders_are_sorted_and_deduplicated(self):
        with TempRepo() as repo:
            repo.write("b.txt", "1\n")
            base = repo.commit("base")

            repo.write("b.txt", "2\n")
            repo.commit("first")
            repo.write("a.txt", "1\n")
            repo.write("b.txt", "3\n")
            repo.commit("second")

            self.assertEqual(cg.code_moved_since(repo.root, base, "cyc"), ["a.txt", "b.txt"])

    def test_unresolvable_revision_is_none_not_empty(self):
        # None means "cannot tell", and the caller treats it as stale. An
        # empty list would mean "nothing moved" and let the merge through.
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            repo.commit("base")
            self.assertIsNone(cg.code_moved_since(repo.root, "0" * 40, "cyc"))


# --------------------------------------------------------------------------
# inspect - the report state machine
# --------------------------------------------------------------------------


class InspectTests(unittest.TestCase):
    def test_missing_report_blocks(self):
        with TempRepo() as repo:
            closing_cycle(repo, "cyc")
            repo.commit("base")
            reason = cg.inspect(repo.root, "cyc", repo.head())
            self.assertIsNotNone(reason)
            self.assertIn("does not exist", reason)
            self.assertIn("openspec/changes/cyc/claims-report.md", reason)

    def test_report_without_a_revision_line_blocks(self):
        with TempRepo() as repo:
            closing_cycle(repo, "cyc", "# report\n\n| a claim | CONFIRMED |\n")
            repo.commit("base")
            reason = cg.inspect(repo.root, "cyc", repo.head())
            self.assertIn("Verified revision", reason)

    def test_report_at_head_with_confirmed_claims_passes(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")
            closing_cycle(repo, "cyc", report(base))
            repo.commit("close the cycle")
            self.assertIsNone(cg.inspect(repo.root, "cyc", repo.head()))

    def test_a_short_sha_still_matches_head(self):
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(repo, "cyc", report(head[:12]))
            # Not committed: the report records this exact HEAD.
            self.assertIsNone(cg.inspect(repo.root, "cyc", head))

    def test_behind_head_by_cycle_only_commits_passes(self):
        # The commit that adds a report can never contain its own sha, so
        # "behind HEAD" must not by itself mean stale. This is the case that
        # a strict `revision == HEAD` reading could never satisfy.
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")
            closing_cycle(repo, "cyc", report(base))
            repo.commit("close the cycle")
            repo.write("openspec/changes/cyc/tasks.md", "- [x] done\n")
            repo.commit("tick the last box")

            self.assertNotEqual(repo.head(), base)
            self.assertIsNone(cg.inspect(repo.root, "cyc", repo.head()))

    def test_code_moved_after_verification_blocks(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")
            closing_cycle(repo, "cyc", report(base))
            repo.commit("close the cycle")
            repo.write("apps/api/src/app.ts", "export const a = 2;\n")
            repo.commit("move the code")

            reason = cg.inspect(repo.root, "cyc", repo.head())
            self.assertIn("stale", reason)
            self.assertIn("apps/api/src/app.ts", reason)

    def test_unresolvable_revision_blocks(self):
        with TempRepo() as repo:
            closing_cycle(repo, "cyc", report("0" * 40))
            repo.commit("base")
            reason = cg.inspect(repo.root, "cyc", repo.head())
            self.assertIn("cannot be resolved", reason)

    def test_report_with_no_verdict_rows_blocks(self):
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(
                repo, "cyc", "# report\n\n**Verified revision:** `{0}`\n".format(head)
            )
            self.assertIn("no verdict rows", cg.inspect(repo.root, "cyc", head))

    def test_a_refuted_claim_blocks(self):
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(
                repo,
                "cyc",
                report(head, rows=(("ok", "CONFIRMED"), ("false statement", "REFUTED"))),
            )
            reason = cg.inspect(repo.root, "cyc", head)
            self.assertIn("REFUTED", reason)
            self.assertIn("1 REFUTED", reason)

    def test_unaccepted_unverifiable_blocks(self):
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(repo, "cyc", report(head, rows=(("unclear", "UNVERIFIABLE"),)))
            self.assertIn("UNVERIFIABLE", cg.inspect(repo.root, "cyc", head))

    def test_partially_accepted_unverifiable_blocks(self):
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(
                repo,
                "cyc",
                report(
                    head,
                    rows=(("one", "UNVERIFIABLE"), ("two", "UNVERIFIABLE")),
                    accepted=1,
                ),
            )
            self.assertIn("only 1 are recorded", cg.inspect(repo.root, "cyc", head))

    def test_accepted_unverifiable_passes(self):
        # An unverifiable claim may ship. It just may not ship silently.
        with TempRepo() as repo:
            repo.write("a.txt", "1\n")
            head = repo.commit("base")
            closing_cycle(
                repo,
                "cyc",
                report(
                    head,
                    rows=(("one", "UNVERIFIABLE"), ("two", "CONFIRMED")),
                    accepted=1,
                ),
            )
            self.assertIsNone(cg.inspect(repo.root, "cyc", head))


# --------------------------------------------------------------------------
# main - the PreToolUse contract, end to end
# --------------------------------------------------------------------------


class MainTests(unittest.TestCase):
    def run_hook(self, root, command, tool_name="Bash", head_ref="feat/cyc", raw=None):
        """Drive main() with a PreToolUse payload, returning (code, stderr)."""
        payload = raw
        if payload is None:
            payload = json.dumps(
                {"tool_name": tool_name, "tool_input": {"command": command}}
            )

        original = {
            "stdin": sys.stdin,
            "stderr": sys.stderr,
            "pr_head_ref": cg.pr_head_ref,
            "env": os.environ.get("CLAUDE_PROJECT_DIR"),
        }
        sys.stdin = io.StringIO(payload)
        sys.stderr = io.StringIO()
        cg.pr_head_ref = lambda *_args, **_kwargs: head_ref
        os.environ["CLAUDE_PROJECT_DIR"] = root
        try:
            code = cg.main()
            return code, sys.stderr.getvalue()
        finally:
            sys.stdin = original["stdin"]
            sys.stderr = original["stderr"]
            cg.pr_head_ref = original["pr_head_ref"]
            if original["env"] is None:
                os.environ.pop("CLAUDE_PROJECT_DIR", None)
            else:
                os.environ["CLAUDE_PROJECT_DIR"] = original["env"]

    def blocked_repo(self, repo, cycle="cyc"):
        """A repo whose `cycle` carries a REFUTED claim, so the gate blocks."""
        repo.write("apps/api/src/app.ts", "export const a = 1;\n")
        base = repo.commit("base")
        closing_cycle(repo, cycle, report(base, rows=(("false statement", "REFUTED"),)))
        repo.commit("close the cycle")

    def test_non_bash_tool_is_ignored(self):
        with TempRepo() as repo:
            self.blocked_repo(repo)
            code, _ = self.run_hook(repo.root, "gh pr merge", tool_name="Read")
            self.assertEqual(code, 0)

    def test_ordinary_command_is_ignored(self):
        with TempRepo() as repo:
            self.blocked_repo(repo)
            code, _ = self.run_hook(repo.root, "git status")
            self.assertEqual(code, 0)

    def test_malformed_payload_is_ignored(self):
        with TempRepo() as repo:
            self.blocked_repo(repo)
            code, _ = self.run_hook(repo.root, None, raw="not json at all")
            self.assertEqual(code, 0)

    def test_no_closing_cycle_allows_the_merge(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            repo.write("openspec/changes/planning/proposal.md", "# proposal\n")
            repo.commit("base")
            code, _ = self.run_hook(repo.root, "gh pr merge 10 --squash")
            self.assertEqual(code, 0)

    def test_refuted_claim_in_the_branch_cycle_blocks(self):
        with TempRepo() as repo:
            self.blocked_repo(repo)
            code, err = self.run_hook(
                repo.root, "gh pr merge 10 --squash", head_ref="feat/cyc-pr1"
            )
            self.assertEqual(code, 2)
            self.assertIn("refusing this merge", err)
            self.assertIn("REFUTED", err)

    def test_unrelated_branch_is_not_blocked_by_another_cycle(self):
        # The whole point of scoping: an unproven cycle must not hold every
        # other PR in the repository hostage.
        with TempRepo() as repo:
            self.blocked_repo(repo, cycle="motor-alertas")
            code, err = self.run_hook(
                repo.root,
                "gh pr merge 10 --squash",
                head_ref="fix/backup-exclude-drizzle-schema",
            )
            self.assertEqual(code, 0)
            self.assertEqual(err, "")

    def test_unresolvable_branch_falls_back_to_every_closing_cycle(self):
        # "Cannot tell if it is related" is not evidence that it is not.
        with TempRepo() as repo:
            self.blocked_repo(repo, cycle="motor-alertas")
            code, err = self.run_hook(repo.root, "gh pr merge 10", head_ref=None)
            self.assertEqual(code, 2)
            self.assertIn("motor-alertas", err)

    def test_clean_report_allows_the_merge(self):
        with TempRepo() as repo:
            repo.write("apps/api/src/app.ts", "export const a = 1;\n")
            base = repo.commit("base")
            closing_cycle(repo, "cyc", report(base))
            repo.commit("close the cycle")

            code, err = self.run_hook(repo.root, "gh pr merge 10 --squash")
            self.assertEqual(code, 0)
            self.assertEqual(err, "")

    def test_outside_a_git_repository_the_gate_stays_silent(self):
        root = os.path.realpath(tempfile.mkdtemp(prefix="claims-gate-nogit-"))
        self.addCleanup(_rmtree, root)
        code, _ = self.run_hook(root, "gh pr merge 10")
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
