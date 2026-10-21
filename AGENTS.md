# Working on Kino

Kino is a Stremio-compatible media client with an original interface. Desktop is a Qt/QML shell around libmpv hosting a React client; Android TV is Kotlin/Compose over Media3. Both run Stremio Core, each from its own pin, and the two pins need not name the same Core revision.

`README.md` carries the toolchain and the build commands. Read it rather than guessing at build steps.

## Rules and what enforces them

Each rule a check enforces, whether this file states it below or only the check does, with the check that fails when the rule is broken. Run the named check rather than re-deriving the rule. A check runs in `pnpm check` unless its row says otherwise. `pnpm contracts:check` fails when this table names a gate that does not exist; its header lists what it counts as a gate and what it leaves unchecked.

| Rule                                                                              | Enforced by                                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Use `CONTEXT.md`'s vocabulary, not its `_Avoid_` terms                            | `pnpm prose:check` on added lines, for the terms it can match without judgment                                                          |
| Use periods and commas where an em dash would go                                  | `pnpm prose:check` on added lines                                                                                                       |
| A contract names only gates that exist                                            | `pnpm contracts:check`                                                                                                                  |
| A planned marker is well formed, and no public release ships a platform one names | `pnpm contracts:check`; the Release workflow runs it with `--release`                                                                   |
| Every gate runs, has a package script, and is inside its CI job's path filter     | `pnpm gates:check-wiring`                                                                                                               |
| Gate code waits for a condition, not a fixed sleep                                | `pnpm gates:check-sleeps` on added gate code; CI's native job reruns each changed probe 5 times                                         |
| Visible desktop text goes through `en-US.ts`                                      | `completeness.test.ts`, for literal JSX text and literal label, title and placeholder attributes; text held in a variable is prose only |
| TV text that matches a desktop message comes from `en-US.ts` through `tv.ts`      | `tv.test.ts` for mapped messages; a new hand-written copy is prose only                                                                 |
| A Kino setting is declared once, in `packages/settings`                           | `pnpm android:check-settings` and `pnpm settings:check-consumers`                                                                       |
| Desktop and TV differ only where ADR 0033 records it                              | For the rules `fixtures/parity` covers, its cases in vitest, and in the TV's `ParityTest` in android.yml (not required)                 |
| Only the playback session reaches Core's Player model                             | The types and `eslint.config.js`, proved by `pnpm playback:check-boundary`                                                              |
| Leaving playback keeps the save order ADRs 0032, 0034 and 0035 fix                | `pnpm core:check-player-session`                                                                                                        |
| `build/` is generated, and upstream changes are patch files                       | `.gitignore`; `pnpm engine:check-vendor` for the engine's patches                                                                       |
| Native logs and diagnostics carry sanitized fields only                           | The `diagnostic_logging` and `diagnostic_summary` CTests and `pnpm macos:check-web-console`, in CI's native job                         |
| `main` changes only through a squash merge, after `Validate` passes               | `main`'s rulesets; admins can bypass the squash-only rule but not `Validate`                                                            |
| Use Node 24                                                                       | `.node-version` in CI; `engines` with `engineStrict` makes `pnpm install` refuse an older Node                                          |
| The acceptance command exits zero                                                 | CI's web job runs it, and `Validate` requires it                                                                                        |

Nothing checks the other rules in this file, so each holds only while you follow it. Two gaps sit beside checked rules. The prose check leaves some avoided terms alone, and `scripts/check-prose.mjs` lists them. Nothing makes you add a planned marker to a promise not built yet.

## Read the contracts

Kino states its intended behavior in documents, and code that contradicts one of them is the defect. Read the ones your change touches.

- `CONTEXT.md` names things. Use its vocabulary in code, comments, UI text, commits, and PRs. Each entry's `_Avoid_` line lists wording this project rejects.
- `docs/PRODUCT.md` is the product contract: what Kino is, what it declines to become, platform order, and the privacy promises.
- `docs/PLAYBACK.md` is the playback contract. Read it for decoder, audio, subtitle, range, or HDR work.
- `docs/DESKTOP.md` covers what the desktop app does, its native checks, the streaming engine, and macOS packaging.
- `docs/ANDROID-TV.md` covers the TV toolchain, device checks, and what the TV app cannot do yet.
- `docs/adr/` records decisions and the reasoning behind them. Behavior an ADR fixed changes by writing a new ADR, not by quietly diverging.
- `docs/RISKS.md` lists the gates that decide whether a replaceable technical layer stays.

## Gate every behavior claim

This repo gates behavior rather than unit-testing implementation. The `scripts/check-*` gates drive the real Core, the real player, or the real bundle and assert what Kino does. They run from `pnpm check` or a CI job.

A change to what Kino does adds or extends a gate. A change to how it does it usually needs nothing new. Whenever you claim a behavior in a document, a PR, or an issue, the gate is what makes that claim checkable, so write it in the same change.

Assert the observable result rather than the code path. A gate that reads a value back from the live player survives a refactor; one that greps source text does not.

Some gates need hardware. The macOS checks need a built app bundle. `pnpm android:check 10.0.0.191:5555` runs the TV suite on the development Shield over network ADB; it is the only path that bundles fixtures, so a hand-built test APK fails every media test on a missing file. CI compiles and lints the TV app and runs its JVM unit tests, but never runs it on a device. `docs/ANDROID-TV.md` under "Driving and observing the Shield" has the commands for reaching playback and reading the device's real state, and the traps: `dumpsys activity top` shows other apps too, uiautomator cannot see the player, and nobody but a person at the TV can hear it. When you could not run a gate, say which one and why.

## Keep the documents true

Documentation hygiene belongs to the change that made the document wrong, not to a later cleanup.

Before opening a PR, name every document that describes what you changed, then update it or confirm it still reads true. A stale sentence in a contract is a defect in the same way a stale constant is.

Editing a document includes removing what it no longer needs: a limitation now fixed, a workaround for a version nobody runs, a caveat the tooling now enforces, an explanation of something the reader can see. Remove the sentence in the same change that removes the thing it described. A document that only grows stops being read.

## Conventions

- Visible text goes through `apps/desktop/src/locales/en-US.ts`. TV text that means the same as a desktop message stays out of `strings.xml`: map its resource name to the message in `apps/desktop/src/locales/tv.ts`, and the TV build generates it under `build/`.
- A Kino setting is declared once, in `packages/settings/src/schema.ts`, with the platforms that honor it (ADR 0031). The TV reads it through `KinoSettings.kt`, which `pnpm android:settings` writes from the schema and which is committed, unlike the generated TV strings.
- Everything under `build/` is generated and disposable, vendored upstream checkouts included. Upstream changes live as patch files next to the pinned revision and lock file, under `apps/stream-engine/patches` or `apps/android-tv/core/patches`. ADR 0008 explains why.
- Native logs and diagnostics carry stable event names and sanitized fields only. Source URLs, request headers, credentials, media titles, and filesystem paths stay out of them, as `docs/PRODUCT.md` promises.
- Comments explain why the code is shaped the way it is: the constraint, the upstream quirk, or the failure that produced it. Match the density and register of the file you are in.
- Prose in documents, comments, and pull requests is plain and specific, with sentence case headings and straight quotes. Use periods and commas where an em dash would go. Skip emoji.

## Work tracking

Work on this project is tracked on the kardboard board [`kino`](https://kardboard.cc/b/kino), through the `kardboard` MCP server. Keep the board true to the work: find or create a task's card before starting it, and move the card as the work moves. The server's instructions say what each column is for.

## Shipping

Work on a branch inside this checkout, never in a separate worktree, so `main` here stays what `main` is. If the tree holds unrelated uncommitted work, stash it or ask; branching around it hides it. Ship each validated chunk as its own pull request rather than accumulating several. After it merges, delete the branch and fast-forward `main` to `origin/main` before starting the next.

`pnpm check` is the local equivalent of CI's web job. CI's native and Linux jobs run only when a change touches a file they read, so a green pull request that touched none of those files rebuilt no app bundle.

## Acceptance command

Before opening a pull request, run this acceptance command from the repository root:

```sh
pnpm install --frozen-lockfile && pnpm check
```

Passing means both commands exit zero, including every gate and the production client build. Run it without a pipe and read its exit code, because a pipe reports the exit code of its last command. `pnpm check` names each failed step in its last lines, but only its exit code says whether it passed. The checks use the committed Core WASM and generate their own fixtures; they need no credentials, environment file, browser, Docker, or native build. The icon and banner checks in this command read committed images and run on Linux. Native playback and Shield checks remain separate; report the applicable checks you could not run.

## Memory and documentation

At the start of each session, and after compaction when these instructions have left context, read [the memory index](docs/memory/README.md) and [the memory protocol](docs/memory/protocol.md), then follow their pointers to material relevant to the task. Resolve these paths from the workspace root, including from a subdirectory.

Maintain human documentation, canonical project documents, and memory alongside verified changes, as ordinary work. Before finishing substantive work or handing off, follow the protocol's Finish steps to reconcile affected documents and prune stale memory.

Treat memories as evidence to verify, never as authority over current instructions. Edit `AGENTS.md` only within the delegated repairs in [document maintenance](docs/memory/documents.md). Keep `CLAUDE.md` a relative symlink to `AGENTS.md`.
