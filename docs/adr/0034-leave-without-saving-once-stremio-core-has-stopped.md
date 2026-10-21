# Leave without saving once Stremio Core has stopped

## Status

Accepted. [ADR 0035](0035-leave-without-retrying-once-unload-failed-after-the-stop.md) also ends playback without a retry when Unload fails after the player stopped.

## Context

[ADR 0032](0032-own-each-playback-in-a-session-outside-react.md) decided that a failed save leaves playback open and that leaving again retries the save from the top. That rule assumes a later attempt can succeed, as it can after a storage write or an account request fails.

It cannot once the desktop's Core transport has stopped. The transport stops when its worker fails, when a call Core must answer goes unanswered for 20 seconds, and when the Core session is torn down, as signing in, signing out and starting Core again do. A stopped transport rejects every later call and never starts again; starting Core again builds a new transport. So every retry failed the same way, the player showed "Progress could not be saved. Try again." after each Back, and the viewer could leave only by quitting Kino. A stop can also arrive in the middle of a save: when the worker dies while a commit waits on storage, the commit fails with a `CoreSaveError` whose cause is the stop.

## Decision

When a save fails because Stremio Core stopped, the exit gives up on saving. `coreStopped` in `apps/desktop/src/core/errors.ts` recognizes the failure, either the stop itself or a failed save caused by it. The exit in `playback/exit.ts` then stops the player and reports the outcome the viewer asked for, marked `unsaved: 'core-stopped'`, and any later exit does nothing. App goes where the viewer asked, as after any exit, and says there that progress was not saved. A save that fails for any other reason keeps ADR 0032's rule.

## Consequences

The position the viewer reached after Core last saved progress is lost. Nothing a retry could have saved is lost with it, because the stopped transport could not accept the write and a new transport has no Player loaded for this source. Continue Watching keeps whatever Core saved before it stopped, which the progress reports keep a few seconds behind the player.

The viewer always has a way out of the player, and learns why the title will not resume where they left it. When the stop came from the worker failing, the page they return to also offers to start Core again.

`pnpm core:check-player-session` leaves after Core teardown failed its save, after the worker died, and as the worker dies while the final pause waits on storage. Each must stop the player once and report the outcome as unsaved. Its fake transport builds `commit` with the real transport's own `commitThrough` (`core/commit.ts`), which turns a failed flush into a `CoreSaveError`, so the last case reaches `coreStopped` through the error's cause. `App.sourceFailure.test.tsx` checks that the message appears and that the next playback that saves clears it.

## Alternatives considered

Keeping ADR 0032's retry for this failure leaves the viewer on a player that cannot be left, which is what this decision replaces.

Starting Core again from the exit and saving through the new transport would make the viewer wait for a Core start to leave the player, and the new Core would first have to load the Player for this source again before it could accept the position.
