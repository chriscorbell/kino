# Full-featured and stable on every platform

Read when: continuing the multi-milestone push tracked in issue #182, or picking the next chunk of platform work.

Status: active
Plan: [issue #182](https://github.com/chriscorbell/kino/issues/182), checked off as each pull request merges.
Source: Chris's instruction of 2026-09-25 to plan and implement a full-featured, stable Kino on all supported platforms, with full agency.

## Continuation facts

- Work runs in milestone order: desktop stability and CI, releases and updates, Android TV daily driver, feature completeness, then Linux and Windows. Each chunk is its own pull request, squash-merged once CI passes.
- The `kardboard` ruleset requires one approving review with an admin bypass. Interactive work merges with `gh pr merge --squash --delete-branch --admin`, as `AGENTS.md` Shipping describes.
- The development Shield answers at `10.0.0.191:5555`. If `adb connect` reports "No route to host" while `nc -z 10.0.0.191 5555` succeeds, restart the adb server (`adb kill-server`) and connect again.
- The running desktop app can be driven without taking over the screen: launch `build/macos/Kino.app/Contents/MacOS/Kino` with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:<port>` and use the DevTools protocol. Accessibility clicks do not reach WebEngine content.
- Windows (`gaming-pc`, PowerShell over SSH) and Linux with an AMD GPU (`minicore`) are reachable for Milestone 5 hardware checks.

## Waiting on Chris

- Android release signing key: generating it and storing it as repository secrets needs his yes.
- The v0.1.0 tag waits on his daily-driver retest.

Close when: every box in #182 is checked or explicitly deferred there.
