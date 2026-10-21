# Leave without retrying once Unload failed after the stop

## Status

Accepted

## Context

[ADR 0032](0032-own-each-playback-in-a-session-outside-react.md) decided that a failed save leaves playback open and that leaving again retries the save from the top. [ADR 0034](0034-leave-without-saving-once-stremio-core-has-stopped.md) made one exception, a save that fails because Stremio Core stopped.

The save stops the player once the final pause is durable, then commits Unload, which waits for the writes Unload causes. After an ended playback Unload resets the stored offset, and after Up Next it can advance Continue Watching to the next episode. When one of those writes fails, Core has already unloaded the Player in memory, so a retry has nothing to unload and nothing to write again. Leaving again ran the save, found no write pending, and reported the outcome as durable although the reset never reached storage. Until then the player sat stopped under "Progress could not be saved. Try again.", the same text a save that can still succeed shows.

## Decision

When the save fails after it stopped the player, the exit in `playback/exit.ts` ends at once. It reports the outcome the viewer asked for, marked `unsaved: 'unload-failed'`, logs that progress was not saved, and any later exit does nothing. App goes where the viewer asked and says there that progress could not be saved. A failure before the stop keeps ADR 0032's retry, and a failure because Core stopped keeps ADR 0034's, now marked `unsaved: 'core-stopped'`.

## Consequences

The final position is durable, because the stop follows the durable final pause, so what is lost is only what Unload would have written.

A failed save offers a retry only while one can succeed, and the player view never shows a stopped player as one the viewer can resume.

`pnpm core:check-player-session` fails Unload's write after an ended playback over the pinned Core. The outcome must arrive at once, marked unsaved, while storage still holds the offset the reset would have replaced. `session.test.ts` checks the outcome and the log, and `App.sourceFailure.test.tsx` checks the message.

## Alternatives considered

A separate exit state that keeps the stopped player on screen until the viewer leaves again would tell the viewer the truth, but it makes them leave twice and offers nothing to do in between.

Retrying only Unload's flush would succeed honestly when storage was merely slow, but after a rejected write it finds nothing pending and reports the same false success.
