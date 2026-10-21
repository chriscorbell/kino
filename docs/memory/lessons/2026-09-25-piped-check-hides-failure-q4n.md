# A piped check reports the pipe's exit code

Read when: running `pnpm check` or any other check before a commit, push, or pull request, or a pull request says a check passed that CI then fails.
Status: verified
Scope: workspace, every shell that runs a check
Verified: 2026-10-21
Source: `AGENTS.md` "Acceptance command"; `scripts/run-check.mjs` (#299); the agent-friendly program's mining of session transcripts for 2026-09-25, 2026-09-26 and 2026-09-28 (`data/recall.tsv` in its store, on mbp only)
Recheck when: `scripts/run-check.mjs` changes the lines it prints at the end of a run.

A pipeline exits with the status of its last command, so in `pnpm check | tail -5 && git push` the push runs whenever `tail` succeeds, which is always. Run the acceptance command with no pipe and read its exit code. To keep the output short, read the end of the run instead of piping it: since #299, `pnpm check` ends with a `FAIL` line for each failed step and a summary line, `check failed: N of M steps ...` or `check passed: M steps ...`. No hook or check enforces the unpiped rule; `AGENTS.md` states it. The program's records name three times a command of this shape hid a failure: pushes past a failed check on 2026-09-25 and 2026-09-26, and #286 opened on 2026-09-28 with a description saying `pnpm check` passed while it had failed. All three are unverified: they come from transcripts, and GitHub records no edit to #286's description, though the records say it was corrected. Checked on 2026-10-21 against `scripts/run-check.mjs`, `AGENTS.md`, and #286.
