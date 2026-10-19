# Agent-friendly program

Read when: picking up, resuming, or adding to the program that restructures Kino so agents stop repeating the same mistakes, or before running heavy commands or the Shield while it is in flight.

Status: active.
Source: the plan Chris approved on 2026-10-18 and his decisions of the same day. The plan and its evidence (mining tables, prototype reports, decision trail) live only on agent-pc, under `~/.claude/projects/-home-milo-Code-kino/agent-friendly/`; this note carries what another machine needs.
Card: "Rearchitect the repo so agents stop repeating the same mistakes" on the [kino board](https://kardboard.cc/b/kino). Each unit below has its own card.

## Objective

A review of every commit, pull request and issue found 126 commits that fixed an earlier mistake made in this repo, clustered on language boundaries and in the desktop player. The program moves each repeating mistake class up to architecture, types or a check whose error names the fix, so the wrong thing becomes hard to write rather than something an agent has to remember.

## Workstreams and units

- A. Make green mean something. A1 gate-wiring check in `pnpm check`; A2 `pnpm check` runs every step and names each failure; A3 native CI trigger computed from what native jobs import; A4 require `Validate` on `main`; A5 timing gates rerun 5 times on their platform, sleeps need a reason; A6 weekly `intro:check-live` in CI; A7 gates for #47 and #50.
- B. Promises match wiring. B1 one settings schema, with a generated `KinoSettings.kt` for the TV; B2 the shell reports capabilities and Settings shows only honored controls; B3 a consumer check per setting; B4 a per-platform `planned` marker the release check enforces.
- C. One source across languages. C1 shared TV strings generated from `en-US.ts`; C2 `notices:check` compares the Flatpak stream-server and Core pins; C3 one global reduced-motion rule.
- D. Desktop and TV test against the same cases. D1 TV JVM tests in CI over shared `fixtures/parity/*.json`; D2 more rules join the fixtures; D3 an ADR listing intended differences between clients; D4 TV proxy-header validation matches desktop.
- E. The desktop playback session gets one owner. E1 settings have one writer; E2 volume has one owner; E3 a durable Core write is one `commit()`; E4 one media event stream for mpv and `<video>`; E5 the session owns the Core player model and the exit; E6 a lint boundary around player features; E7 (optional) native pause has one writer.
- F. Rules where agents read them. F1 the `AGENTS.md` rule table and lessons moved into `docs/memory/lessons/`; F2 a check on added lines for em dashes and `CONTEXT.md` `_Avoid_` words.

W0 is this note.

## Order

1. A1, A2, A4.
2. D1, then C1. Alongside: F2, E3, C3, A6, A7.
3. B1, then B2 and the static and Linux layers of B3.
4. E4, E1, E2, E5, E6, then the behavioral layer of B3.
5. A3, A5, B4, C2, D2, D3, D4, E7, then F1 last, once the checks it lists exist.

## Decisions (Chris, 2026-10-18)

- Full autopilot: each pull request has one owner who builds it and merges it, but only after CI is green and an independent verification of its head passes.
- A4 is blocked on Chris. `milo-devbot` is not a repository admin, so Chris adds the required check himself.
- Separate git worktrees are allowed for this program, an exception to the `AGENTS.md` rule.
- The Shield's rc.6 release may be replaced to run the TV suite, with a release build reinstalled at the end.
- Product calls take the plan's defaults: intro chapter choice and automatic skip use the TV's rule on both clients; both accept IMDb and TMDB intro ids; leaving the player after the Core worker died reports the failed save and leaves; Library sort labels use the desktop wording.
- Align: TV bitrate quotes the add-on's figure, sizes round on both clients, episode ties sort by code point, desktop next episode and resume follow the TV, and TV proxy-header validation matches desktop's.
- Record as intended: subtitle delay step and limit, seek step, subtitle size and position scales, remembered-track storage fields, progress report cadence, and refresh-rate mode choice.

## Operating rules

- At most 3 worktrees at once. Seven parallel prototypes exhausted agent-pc's 15 GB during planning.
- Run every `pnpm install`, `pnpm check`, vitest run, Gradle task, CMake build and native probe under `flock /tmp/kino-heavy.lock`.
- Run `./gradlew --stop` in `apps/android-tv` after any Gradle use.
- Use the Shield only under `flock /tmp/kino-shield.lock`, and only for units that touch TV code (B1, C1, D1, D4).
- As of 2026-10-18 the Shield still runs the rc.6 release, and `check-android.py` refuses to run over a release. Uninstalling rc.6 clears the TV's sign-in and settings. Check it with `adb -s 10.0.0.191:5555 shell pm list packages | grep app.kino.tv`, or run `pnpm android:check`, which refuses over a release. Per Chris's choice, the first builder whose unit touches TV code uninstalls rc.6, once, under the Shield lock.

## Next action

As of 2026-10-18, A1 and A2 are in flight and A4 waits on Chris. Once they merge, start wave 2, and keep each unit's card true to its pull request.

Close when: every unit is merged or explicitly dropped, and a release build is reinstalled on the Shield.
