# Own each playback in a session outside React

## Status

Accepted. [ADR 0034](0034-leave-without-saving-once-stremio-core-has-stopped.md) changes what leaving does after a save fails because Stremio Core stopped.

## Context

`PlayerScreen` owned playback on the desktop. It held the Core Player model through `useCoreModel`, the media backend, progress reports, track memory, volume, and the save that every exit runs, so playback lived exactly as long as the component's mount. Unmounting the screen was an exit, and React StrictMode's practice unmount ran a complete save and Unload. The save itself was split between `PlayerScreen`, a `beforeUnload` option of `useCoreModel`, and the transport's close hooks.

Each rule held only while effects ran in the right order and their dependencies kept the right identities. App kept its source-failure handler's identity stable so the load effect would not restart a playing stream, and a profile sync during playback reloaded the stream because the profile's language was a dependency of that effect. #91 fixed one wrong order in this chain. #200 moved torrent, intro, keyboard and subtitle code into hooks, and these problems stayed, because a hook's lifetime is still the mount.

## Decision

A playback session owns one viewing of one source. `startPlayback` in `apps/desktop/src/playback/session.ts` creates it, and App starts it from the viewer's action through `usePlaybackHost`. Only the session ends itself. Back, Up Next, a source failure, window close, Quit, and the Core session ending underneath playback all run the one save in `playback/exit.ts` and report one outcome to App. `PlayerScreen` reads the session's snapshot and calls its controls, so mounting, unmounting or remounting it starts, saves and unloads nothing.

The session is the only reader and writer of Core's Player model. It loads the model once, reads the profile's languages once, and resolves the source once. It owns the media backend, progress reports, per-title track memory and the volume it sends. A second play while a session is live is ignored.

The save keeps the order the playback contract states, and every step is safe to repeat. An exit that arrives while a save runs joins it, and the first outcome wins. A failed save leaves playback open, and leaving again retries from the top.

## Consequences

The view's lifecycle is no longer an exit path. A test asserts that unmounting the view while playing dispatches no save and no Unload, and the shutdown test's former unmount case closes the transport instead.

`pnpm core:check-shutdown` runs `savePlayback` itself against the pinned Core, so it checks the client's own order rather than a copy written into the gate, and `pnpm core:check-player-session` drives the session itself through every exit. The modules they load keep explicit `.ts` value imports so plain Node can load them. Outside `apps/desktop/src/playback/`, lint fails an import of the Player actions (`playerAction`, `loadPlayerAction`, `unloadPlayerAction`, `finalPauseAction`) and a call naming the model as the literal `'player'`: `useCoreModel('player')`, `getState('player')`, or a dispatch or commit to `'player'`.

A profile change during playback applies to the next playback instead of reloading the stream. Window close and Quit show that progress is being saved while the shell waits for the save, as Back already did. Once that save is durable, App returns to the details page before the window closes. A finished session has no Back, so a stopped player left on screen would strand the viewer if the shell stopped waiting before the save landed.

Playback state lives in an external store that the view reads with `useSyncExternalStore`, as Kino settings and update state already do.

## Alternatives considered

Splitting `PlayerScreen` further into hooks keeps the lifetime in a mount, which #200 showed does not remove the ordering and identity problems.

A pure reducer with an effect interpreter makes the synchronous logic easy to test, but the save is asynchronous and still needs an imperative runner, so two layers would both know it.

Moving the managed unload into the Core transport keeps one door to Core, but the transport would have to learn the media backends, volume and track memory, and the view would still own the backend.

Saving progress from the native shell fails ADR 0018: Core runs in the web process's worker, so the shell would read Core state that no adapter has validated, and the browser build would have no owner.
