# Deleting or force-pushing a branch can close a pull request for good

Read when: merging a pull request that others are stacked on, deleting a branch, merging a draft, or force-pushing a branch that has a pull request.
Status: verified
Scope: GitHub pull requests on chriscorbell/kino
Verified: 2026-10-21
Source: #233, #238; rulesets `kardboard` (23392940) and `Require Validate` (25512872); `.github/workflows/ci.yml` job `validate`; the traps of 2026-09-25 that #329 moved here from `docs/memory/work/2026-09-25-full-featured-plan-k7q.md`
Recheck when: either ruleset or the repository's merge settings change.

Deleting a branch closes every open pull request whose head or base it is. #233 closed when the #232 merge deleted its base branch; its head was then force-pushed, and a pull request whose head moved after it closed cannot be reopened, so #238 replaced it. A pull request closed by deleting its head comes back if you push the branch again at the same commit (`git push origin <local>:refs/heads/<branch>`) and run `gh pr reopen`. Before you merge the base of a stack with `--delete-branch`, retarget each child to `main` (`gh pr list --json number,headRefName,baseRefName` shows the stack). Update a stacked branch by merging its base or `origin/main` into it rather than rebasing, which needs no force push; the squash merge flattens the history anyway. `gh pr merge` refuses a draft, so run `gh pr ready <n>` first and confirm the merge happened before deleting anything. As of 2026-10-21, `main` accepts only squash merges through a pull request, with no approvals required, and blocks deletion and force pushes; the `Validate` check is required. Admins can bypass the `kardboard` ruleset and `gh` on mbp runs as Chris, so never pass `--admin`. The repository does not delete head branches on merge by itself. The rulesets and #233 and #238 were checked on 2026-10-21; the draft refusal and the reopen rule are unverified, from 2026-09-25.
