# Declare each Kino setting once, with the platforms that honor it

## Status

Accepted

## Context

Desktop and TV declared Kino settings separately. Desktop's `settings.ts` wrote out each field's type, default and validation by hand. The TV read each preference by a string key and repeated its default at every call site, so a mistyped key or a different default compiled, and the two clients agreed only because nobody had changed one side.

Nothing said which platforms a setting applied to. Settings controls with nothing behind them were found by hand: #98 removed a frame-rate switch nothing read, and #240 hid a Linux switch that did nothing.

## Decision

`packages/settings/src/schema.ts` is the one place a Kino setting is declared. Each entry gives the setting's domain and default, and lists the platforms that honor it among macOS, Windows, Linux and the TV. A desktop platform names what applies the setting there, the React client or a capability of the shell, and the TV names the preference that stores it. A platform missing from an entry does not honor the setting.

The desktop client derives its settings record, defaults and validation from the schema. It stores every setting a desktop platform lists.

The TV reads and writes Kino settings only through the typed entries in `KinoSettings.kt`, which `scripts/generate-tv-settings.mjs` writes from the schema. A setting the schema does not list for the TV has no entry, so TV code has nothing to read. The TV keeps the preference names it already stored, so existing values carry over.

A setting has one domain and default on every platform that lists it, unless it means something different on one. Subtitle size and position use mpv's percentages on desktop and steps of Media3's text size and padding on the TV, so the TV entry gives its own domain and default. That difference is intended.

## Consequences

Adding a setting, or offering one on another platform, starts in the schema. The schema is what later checks build on: showing a Settings control only where its platform honors it, and proving that every platform a setting lists has something that reads it.

The generated Kotlin file is committed, so a schema change shows the Kotlin it produces in the same diff and the TV sources resolve without a generation step. `pnpm android:check-settings`, part of `pnpm check`, fails when the committed file differs from what the schema gives, and `pnpm settings:check-consumers` fails when a TV source reads, writes or removes one of the schema's TV preferences by its raw key.
