# Delivery roadmap

Each phase ends in something Chris can run and validate. A later phase does not begin by broadening the earlier phase's scope.

## Phase 0: foundation

- Establish the monorepo, licenses, formatting, checks, and exact dependency pins.
- Preserve the mockup and logo as design inputs.
- Define shared color, typography, spacing, motion, and focus tokens.
- Establish sanitized rotating desktop logs before feature work becomes difficult to diagnose.

Exit: the desktop project builds locally, CI validates it, and its empty shell matches the approved design language.

## Phase 1: browser vertical slice

- Run the original React client against Stremio Core Web and a separately installed Stremio Service.
- Implement Stremio sign-in, guest mode, Home, one series detail route, episode and source selection, and playback.
- Save and restore progress.
- Resolve one trusted intro marker and exercise manual Skip Intro.

Exit: Chris can launch the local client on the Mac and complete the agreed first-run-to-playback path with useful logs when anything fails.

## Phase 2: native macOS validation

- Introduce the narrow `stremio-shell` fork and load Kino's client from packaged local assets.
- Rebrand the shell, keep authentication material in owner-only local storage, and modernize the build for Apple Silicon.
- Implement the full SDR, hardware-decoding, audio, subtitle, source-failure, and playback-lifecycle contract.
- Validate the open torrent engine. A separately installed Stremio Service remains development-only.

Exit: the native Apple Silicon build completes the vertical slice, passes representative playback fixtures, and bundles no unverified streaming blob.

## Phase 3: macOS version one

- Complete Discover, Search, Library, add-on management, Settings, resume, Up Next, and automatic intro skipping.
- Add accessibility, localization structure, cache management, update prompts, and diagnostic actions.
- Produce a signed and notarized universal package with checksums.

Exit: the release meets the product and playback contracts and torrent sources work through the approved engine.

## Phase 4: Android TV

- Build the Kotlin and Compose presentation around the Stremio Core Kotlin bridge.
- Prototype Media3 hardware decoding and HDR-to-SDR conversion on the NVIDIA Shield before committing the player backend.
- Integrate secure TV sign-in, remote focus, fullscreen playback, audio passthrough and downmix, subtitles, and the approved torrent engine.
- Validate behavior and collect sanitized diagnostics through network ADB.

Exit: the signed sideloadable APK completes the same daily-driver flow using a remote and satisfies the playback contract on the Shield.

## Phase 5: Windows and Linux

- Port the proven desktop shell changes and packaging.
- Validate hardware-decoder filtering, SDR conversion, audio output, filesystem paths, secure storage, updates, and logs on each operating system.
- Publish signed Windows packages and a Flatpak after platform-specific validation.

Exit: each package satisfies the same product contract without platform-specific silent fallbacks.

## Validation strategy

- Focus unit tests on intro-marker trust, source compatibility, guest/account separation, and progress transitions.
- Exercise Stremio Core boundaries with integration tests rather than duplicating upstream internals.
- Maintain legal playback fixtures covering the declared codecs, ranges, audio formats, subtitles, and failure paths.
- Automate the sign-in/guest-to-playback path where platform tooling is reliable.
- Treat real-device checks as release gates for HDR-to-SDR correctness, hardware-only video decoding, audio negotiation, remote focus, and sleep behavior.
