# Working on Kino

Kino is a Stremio-compatible media client with an original interface. Desktop is a Qt/QML shell around libmpv hosting a React client; Android TV is Kotlin/Compose over Media3. Both read the same pinned Stremio Core.

`README.md` carries the toolchain and the build commands. Read it rather than guessing at build steps.

## Read the contracts

Kino states its intended behavior in documents, and code that contradicts one of them is the defect. Read the ones your change touches.

- `CONTEXT.md` names things. Use its vocabulary in code, comments, UI text, commits, and PRs. Each entry's `_Avoid_` line lists wording this project rejects.
- `docs/PRODUCT.md` is the product contract: what Kino is, what it declines to become, platform order, and the privacy promises.
- `docs/PLAYBACK.md` is the playback contract. Read it for decoder, audio, subtitle, range, or HDR work.
- `docs/ANDROID-TV.md` covers the TV toolchain, device checks, and what the TV app cannot do yet.
- `docs/adr/` records decisions and the reasoning behind them. Behavior an ADR fixed changes by writing a new ADR, not by quietly diverging.
- `docs/RISKS.md` lists the gates that decide whether a replaceable technical layer stays.

## Gate every behavior claim

This repo gates behavior rather than unit-testing implementation. The `scripts/check-*` gates drive the real Core, the real player, or the real bundle and assert what Kino does. They run from `pnpm check` or a CI job.

A change to what Kino does adds or extends a gate. A change to how it does it usually needs nothing new. Whenever you claim a behavior in a document, a PR, or an issue, the gate is what makes that claim checkable, so write it in the same change.

Assert the observable result rather than the code path. A gate that reads a value back from the live player survives a refactor; one that greps source text does not.

Some gates need hardware. The macOS checks need a built app bundle. `pnpm android:check 10.0.0.191:5555` runs the TV suite on the development Shield over network ADB; it is the only path that bundles fixtures, so a hand-built test APK fails every media test on a missing file. CI compiles and lints the TV app but never runs it on a device. `docs/ANDROID-TV.md` under "Driving and observing the Shield" has the commands for reaching playback and reading the device's real state, and the traps: `dumpsys activity top` shows other apps too, uiautomator cannot see the player, and nobody but a person at the TV can hear it. When you could not run a gate, say which one and why.

## Keep the documents true

Documentation hygiene belongs to the change that made the document wrong, not to a later cleanup.

Before opening a PR, name every document that describes what you changed, then update it or confirm it still reads true. A stale sentence in a contract is a defect in the same way a stale constant is.

Editing a document includes removing what it no longer needs: a limitation now fixed, a workaround for a version nobody runs, a caveat the tooling now enforces, an explanation of something the reader can see. Remove the sentence in the same change that removes the thing it described. A document that only grows stops being read.

## Conventions

- Visible text goes through `apps/desktop/src/locales/en-US.ts`. `completeness.test.ts` fails on a gap.
- Everything under `build/` is generated and disposable, vendored upstream checkouts included. Upstream changes live as patch files next to the pinned revision and lock file, under `apps/stream-engine/patches` or `apps/android-tv/core/patches`. ADR 0008 explains why.
- Native logs and diagnostics carry stable event names and sanitized fields only. Source URLs, request headers, credentials, media titles, and filesystem paths stay out of them; `docs/PRODUCT.md` promises this and several gates enforce it.
- Comments explain why the code is shaped the way it is: the constraint, the upstream quirk, or the failure that produced it. Match the density and register of the file you are in.
- Prose in documents, comments, and pull requests is plain and specific, with sentence case headings and straight quotes. Use periods and commas where an em dash would go. Skip emoji.

## Shipping

Work on a branch inside this checkout, never in a separate worktree, so `main` here stays what `main` is. If the tree holds unrelated uncommitted work, stash it or ask; branching around it hides it. Ship each validated chunk as its own pull request rather than accumulating several. Squash-merge once CI is green, delete the branch, and fast-forward `main` to `origin/main` before starting the next.

`pnpm check` is the local equivalent of the CI web job. The macOS native job runs only when native inputs change, and packaging runs on pushes to `main`, so a green pull request does not always mean the bundle was rebuilt.
