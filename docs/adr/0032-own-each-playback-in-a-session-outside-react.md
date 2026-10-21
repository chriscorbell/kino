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

`pnpm core:check-shutdown` runs `savePlayback` itself against the pinned Core, so it checks the client's own order rather than a copy written into the gate, and `pnpm core:check-player-session` drives the session itself through every exit. The modules they load keep explicit `.ts` value imports so plain Node can load them.

The types keep a screen or component that holds the transport off the Player model, as long as nothing below gets past them. `useCore()` hands screens and components a `FeatureTransport`, which takes no model but the others and no action that reaches the Player model: the Player actions carry their own brand, an `Unload` goes out only with a model, and only `core/actions.ts` can brand an action. A type with method members would accept that transport without checking its methods' parameters, so feature code writes function-typed properties, whose parameters TypeScript checks strictly. The session alone reads the full transport from the context.

Lint keeps the ways around the types closed. Each module that reaches the Player model lists the only files that may import it, and `eslint.config.js` gives each file's reason. `CoreContext` goes to `CoreProvider` and to `playback/react.ts`, which starts the session. The full transport, `createCoreTransport` and its `CoreTransport` type, goes to `CoreProvider`, to the context that hands it to the session, and to `core/commit.ts`, which builds its `commit`. Signing in runs a Core of its own through `createSignInCore`, which hands out only the feature transport and the means to start and stop it. The Player actions go to the session modules that load, report and save (`session.ts`, `progress.ts` and `exit.ts`), the native player to `playback/react.ts`, and the session's internals to the session alone. Any other file fails at its import, so a barrel or a re-export cannot hand one on. A file that needs one of these joins its zone with its reason and a plant in the boundary check. Lint resolves each import to the file it names, so a renamed import, a `.ts` or `.js` suffix, a `../` detour, a namespace or type import, a re-export, a module augmentation and a dynamic import of a literal, a template literal with no substitutions among them, all count. Player features, under `player/`, `screens/PlayerScreen*`, `components/AudioTrackPicker*` and `components/SubtitlePanel*`, also import nothing from the transport, the context, `useCoreModel`, the action types, `CoreProvider`, the native modules or `unloadAction`, and reach playback through `playback/index.ts`. A barrel elsewhere could still hand a player feature `useCore()`, whose transport the types fence.

In the app, lint also refuses a cast through another type such as `as unknown as`, a cast to `never`, the `any` type, a cast or type predicate aimed at a type it traces to `core/writes.ts`, `core/transport.ts` or `ModelOutsideSession`, a method signature outside `core/`, `native/` and `playback/`, a `@ts-expect-error`, an inline comment that turns a rule off, and an import it cannot resolve: a computed `import()`, `import.meta.glob` and `require`. Test files (`*.test.ts` and `*.test.tsx`) and `src/test/` are exempt, because they fake the session's dependencies and read the Player model to check what the session did; the same patterns keep the app from importing them. Core's worker may cast, because it holds every model already. `pnpm lint` and the boundary check both run the root config, so an `eslint.config.js` nearer a file cannot switch any of this off.

The fence is meant to stop a mistake, not a determined way around it, and these ways stay open:

- A value TypeScript already types `unknown` or `any` passes any type: the result of `JSON.parse`, `Object(transport)`, or a transport method called through `Reflect.apply`.
- A cast or type predicate aimed at a type lint cannot trace to those modules: a literal model name, a type written inline, a type parameter (`<T,>(value: unknown) => value as T`), an alias declared in the same file or another module, or a type read off a value with `typeof`.
- A looser method-typed view of the transport declared in `core/`, `native/` or `playback/`, where method signatures stay allowed.
- A second Core, built from `core/core.worker.ts` through `?worker` or `new Worker(new URL(...))`, or from the `@stremio/stremio-core-web/bridge.js` package. No zone closes the worker module, and lint judges relative imports only.
- An allowed file edited to hand on what it holds, such as `export const FullCoreContext = CoreContext` in `core/context.ts`. Each zone trusts the files it names.
- A symlink, which counts as the path it sits at.
- Code that opens the shell's WebChannel itself.

`pnpm playback:check-boundary` plants one file for each way lint or the types close, and fails when one lints and typechecks clean, or when lint reports it under another rule. It proves the planted forms and no others.

A profile change during playback applies to the next playback instead of reloading the stream. Window close and Quit show that progress is being saved while the shell waits for the save, as Back already did. Once that save is durable, App returns to the details page before the window closes. A finished session has no Back, so a stopped player left on screen would strand the viewer if the shell stopped waiting before the save landed.

Playback state lives in an external store that the view reads with `useSyncExternalStore`, as Kino settings and update state already do.

## Alternatives considered

Splitting `PlayerScreen` further into hooks keeps the lifetime in a mount, which #200 showed does not remove the ordering and identity problems.

A pure reducer with an effect interpreter makes the synchronous logic easy to test, but the save is asynchronous and still needs an imperative runner, so two layers would both know it.

Moving the managed unload into the Core transport keeps one door to Core, but the transport would have to learn the media backends, volume and track memory, and the view would still own the backend.

Saving progress from the native shell fails ADR 0018: Core runs in the web process's worker, so the shell would read Core state that no adapter has validated, and the browser build would have no owner.
