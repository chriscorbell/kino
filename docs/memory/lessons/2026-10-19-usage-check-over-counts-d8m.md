# A usage check that over-counts passes on dead entries

Read when: writing or changing a check that fails when something is unused, such as the en-US message collector or the Kino setting consumer check.
Status: verified
Scope: usage checks in `pnpm check`
Verified: 2026-10-21
Source: #306 and `apps/desktop/src/test/messagePaths.ts`; #313, `scripts/check-setting-consumers.mjs` and `scripts/test-support/setting-consumer-cases.mjs`; the agent-friendly program's audit of #313
Recheck when: `messagePaths.ts` or `check-setting-consumers.mjs` changes how it decides that something is read.

A check that counts too much as a use passes when an entry nobody uses is still there. The message path collector that `completeness.test.ts` uses counted `enUS.settings` inside `enUS.settings.on` as a read of every message under `settings`, so a key no desktop code read looked read; #306 made it count only whole access chains. The first version of the Kino setting consumer check in #313 counted a comment, a string such as `'settings.volume'`, and `typeof settings.volume` as reads, and the TV scan counted a KDoc link; the program's audit found it by removing every real read and seeing the check still pass. #313 now blanks comments and string text and runs 31 planted cases before the real tree. When you write a usage check, plant an unused entry and see it fail, then plant a real read and see it pass, and keep the plants in the check where you can. The message collector has no standing plant. Checked on 2026-10-21 against both pull requests and the current files.
