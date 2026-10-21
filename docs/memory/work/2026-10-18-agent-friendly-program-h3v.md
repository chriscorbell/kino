# Agent-friendly program

Read when: picking up, resuming, or closing the program that restructures Kino so agents stop repeating the same mistakes, or before running heavy commands or the Shield while it is in flight.

Status: active; every unit but E5d and F1 has merged.
Source: the plan Chris approved on 2026-10-18 and his decisions of the same day. The plan and its evidence (mining tables, prototype reports, the replay of the historical mistakes, and the decision trail) live on `mbp`, under `~/.claude/projects/-Users-chris-Code-kino/agent-friendly/`, moved there from `agent-pc` on 2026-10-19; this note carries what another machine needs.
Card: "Rearchitect the repo so agents stop repeating the same mistakes" on the [kino board](https://kardboard.cc/b/kino). Each unit below has its own card.

## Objective

A review of every commit, pull request and issue found 126 commits that fixed an earlier mistake made in this repo, 152 mistakes in all, clustered on language boundaries and in the desktop player. Checks had caught 4 of them as product bugs. The program moves each repeating mistake class up to architecture, types or a check whose error names the fix, so the wrong thing becomes hard to write rather than something an agent has to remember.

## Units and their pull requests

- A. Make green mean something. A1 gate-wiring check (#298); A2 `pnpm check` runs every step and names each failure (#299); A3 the native CI trigger computed from what the native jobs read (#310); A4 `Validate` required on `main` (ruleset, 2026-10-20); A5 a changed timing gate runs five times before merge, and added gate code needs a reason for a fixed sleep (#321); A6 `pnpm intro:check-live` tells an outage from a shape change (#315), and stays a by-hand check because TheIntroDB refuses GitHub-hosted runners; A7 gates for #47 and #50 in the focus probe (#319).
- B. Promises match wiring. B1 one settings schema with a generated `KinoSettings.kt` (#304); B2 Settings shows only what the shell reports it honors (#308); B3 a reader check per setting (#313) and proof that each desktop setting changes playback (#324); B4 planned markers that a public release refuses (#318).
- C. One source across languages. C1 shared TV strings generated from `en-US.ts` (#306); C2 `pnpm notices:check` compares the Flatpak's engine pin with `engine.lock` and names both Core pins (#316); C3 one reduced-motion rule (#314).
- D. Desktop and TV test against the same cases. D1 TV JVM tests in CI over `fixtures/parity` (#303); D2 more shared cases (#312); D3 ADR 0033 records intended differences (#320); D4 TV proxy-header validation matches desktop (#322).
- E. The desktop playback session gets one owner. E1 settings (#307); E2 volume (#309); E3 durable Core writes as one `commit()` (#300); E4 one media event stream (#305); E5 the session, in four merged pull requests: the shared test harness (#311), the session (#317), the exit gate (#323), and resume and Up Next as the TV does them (#327); E5d keeps the session honest during and after a failed save (#328, open); E6 the Player model fenced in types and lint (#326); E7 native pause has one writer (#325).
- F. Rules where agents read them. F1 the `AGENTS.md` rule table, the lessons, this note, and the replay below; F2 the prose check (#302).
- Q1, outside the plan, reviewed notices for Qt 6.12 (#301). W0 is this note (#297).

## Decisions (Chris, 2026-10-18)

- Full autopilot: each pull request has one owner who builds it and merges it, but only after CI is green and an independent verification of its head passes.
- Separate git worktrees are allowed for this program, an exception to the `AGENTS.md` rule.
- The Shield's release build may be replaced to run the TV suite, with a release build reinstalled at the end. On 2026-10-21 Chris allowed any Shield work without asking.
- Product calls took the plan's defaults. ADR 0033 lists the client differences kept on purpose and those still being aligned, each with its card. ADR 0034 records leaving without saving once Stremio Core has stopped.

## Operating rules on mbp

- Up to five unit owners at once, each in its own worktree. `pnpm install`, `pnpm check` and vitest need no lock.
- Run every CMake build, native probe and Gradle task under `lockf -k /tmp/kino-native.lock`, one at a time: the probes open Kino windows on Chris's screen. Use the Shield only under `lockf -k /tmp/kino-shield.lock`, and only on Chris's home network.
- After Gradle, stop the daemons your build started, by pid, as [the lesson on shared machines](../lessons/2026-09-28-shared-lock-and-gradle-daemons-n6p.md) explains.
- The standing orders for owners are in the store's `exec/preferences.md`.

## What the program bought

F1 judged each of the 152 mistakes against `main` at 88220ea. Checks had caught 4 of them as product bugs. Now 96 would be stopped before merge by a check `Validate` requires, or because the old form can no longer be written; 10 of those come from the program's own checks, and the rest from per-mistake tests that `main` did not require before A4. 26 are caught only by a check run by hand, mostly the Shield suite, and 29 by nothing. 26 verdicts were calibrated by running the check at the revision before the fix. The per-class table is in the F1 pull request, and the verdicts, replays and the scripts that rebuild them are in the store's `replay/`.

## Next action

As of 2026-10-21: verify and merge E5d (#328) and F1, reinstall a release build on the Shield, then close this note through the protocol's Finish steps and remove it from the work index.

Close when: every unit is merged or explicitly dropped, and a release build is reinstalled on the Shield.
