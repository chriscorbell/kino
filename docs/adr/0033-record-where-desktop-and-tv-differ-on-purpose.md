# Record where desktop and TV differ on purpose

## Status

Accepted

## Context

Desktop and TV implement many of the same rules twice, once in TypeScript or C++ and once in Kotlin, as [ADR 0003](0003-use-separate-desktop-and-tv-stacks.md) accepted. A review of those rules in October 2026 found that most of them differed between the clients. Some differences were bugs, some were product calls nobody had made, and some were on purpose because the devices or players differ. Nothing in the repository said which was which. A shared parity case that met an intended difference had to hide it in one suite's test code, as the TV's season cases did by turning -1 back into null.

Some of the review's findings closed before this record. The source bitrate label, sub-gigabyte size rounding and the episode tie-break agree on both clients since #303. Intro chapter choice agrees since #312: the desktop requires exactly one intro chapter, as the TV does.

## Decision

The list below is the one record of intended differences in a rule both clients implement. Any other difference in such a rule is a defect. A feature or setting only one platform offers is not a difference in this sense: `packages/settings/src/schema.ts` lists the platforms that honor each Kino setting, as [ADR 0031](0031-declare-each-kino-setting-once-with-the-platforms-that-honor-it.md) decided. A change that adds or removes an intended difference edits this list in the same pull request, citing the code on both clients and the reason.

Where a shared case in `fixtures/parity` meets an intended difference, its expected value names the entry and gives each platform's result, as in `{ "intended": "Unknown season", "desktop": null, "tv": -1 }`. The desktop's vitest suite reads `desktop` and the TV's `ParityTest` reads `tv`, so changing one platform's value fails only that platform's suite. The desktop suite also fails when `intended` names no entry below, and both suites fail when the two values are the same.

### Subtitle delay step and limit

The desktop subtitle panel moves the delay in steps of 500 ms (`SubtitlePanel.tsx`) up to 60 seconds either way (`adjustSubtitleDelay` in `playback/session.ts`). The TV panel moves it in steps of 250 ms (`DELAY_STEP_MS` in `TvSubtitlePanel.kt`) up to 30 seconds either way (`onDelay` in `TvPlayer.kt`). No change records why the steps differ. They are kept on the judgment of the plan that produced this record, that each suits its own input, a click on desktop and a remote press on TV. The delay lasts one playback and is never stored, so nothing crosses between the clients.

### Seek step

On desktop, the arrow keys seek a fixed 10 seconds (`usePlayerKeyboard.ts`). On TV, a press seeks by the Stremio profile's seek time, 10 seconds when unset (`seekStepMs` in `TvCore.kt`), and each further press in a burst adds a ten-thousandth of the runtime (`seek` in `TvPlayerLayout.kt`), as Stremio's TV app does. A remote has no pointer to drag the timeline, so holding a direction is how a viewer crosses a film. The desktop does not honor the profile's seek time.

### Subtitle size and position scales

Desktop subtitle size and position are mpv's `sub-scale` and `sub-pos` percentages (`setSubtitleScale` and `setSubtitlePosition` in `mpvitem.cpp`), changed from the panel in steps of 10 and 5 (`SubtitlePanel.tsx`). The TV offers steps of Media3's text size and bottom padding (`SubtitleAppearance` in `TvSubtitles.kt`). Each is the scale its player takes. [ADR 0031](0031-declare-each-kino-setting-once-with-the-platforms-that-honor-it.md) records the same difference, and `packages/settings/src/schema.ts` gives the TV entries their own domain and default.

### Remembered track fields

Both clients remember a title's embedded audio and subtitle choice by the same rule: tracks of the same kind, then a unique title, then the position among them while their count is unchanged. They describe a track in their own player's terms. The desktop stores language, mpv's codec name, title, and the external, forced and hearing-impaired flags under `kino.tracks.v1:` in local storage (`playback/tracks.ts`). The TV stores language, the MIME type, Media3's role flags, the forced flag and the label under `tracks-v1:` in its preferences (`TitleTrackSelection.kt`). The records are device-local and neither client reads the other's. Add-on subtitle choices are another matter, listed below as not intended.

### Progress report cadence

The desktop reports `TimeChanged` every 5 seconds of media time, after any backwards jump, on pause and at the end (`playback/progress.ts`), because libmpv pushes every change of the playback position and the client thins them. The TV reports every 2 seconds while the player is open (the progress loop in `TvPlayer.kt`, `progress` in `TvCore.kt`), because Media3 sends no position events and the TV asks the player instead. Either way Core's stored offset is a few seconds old at most.

### Refresh-rate mode choice

Both clients look for a display mode at the current resolution whose rate is a whole multiple of the video's, and leave a mode that already is one. The TV takes the smallest multiple (`matchingMode` in `TvFrameRate.kt`), so film plays at 24 Hz. The desktop takes the multiple nearest the current rate (`chooseRefreshMode` in `displaymode.cpp`), so a 160 Hz monitor moves to 144 Hz rather than 24. No change records why the choices differ. They are kept on the judgment of the plan that produced this record: while the TV plays, the video is all it shows, and a desktop display keeps showing the pointer and other windows at the new rate.

The video's rate also comes from each player. The desktop takes mpv's container frame rate (`container-fps` in `mpvitem.cpp`), so a file that states none leaves the display as it is. Media3 does not read the rate a Matroska track states, so the TV reads it itself, and otherwise measures the first three seconds of frame times (`onStatedRate` and `measuredFrameRate` in `TvFrameRate.kt`), as [the playback contract](../PLAYBACK.md) describes.

### Unknown season

A video Core lists without a season belongs to the Other episodes entry on both clients, sorted after every numbered season. The desktop marks it with `null` (`availableSeasons` in `core/seasons.ts`). The TV marks it with -1 (`seasonNumber` in `Seasons.kt`), and every TV caller that names a season must know it (`TvDetails.kt` shows Other episodes for -1). Viewers see the same list. The shared season cases give each client's marker.

### Matroska chapter fields

The desktop reads chapters from libmpv's chapter list, which carries only each chapter's title and start time (`chapterPayload` in `mpvitem.cpp`). The TV reads the Matroska Chapters element itself (`MatroskaChapters` in `TvIntroMarkers.kt`), so it also honors fields libmpv does not pass on. A chapter's own end time bounds the intro before the next chapter's start does. A chapter marked as an opening by its skip type counts without a label. A disabled or hidden intro chapter, or an ordered edition, leaves the intro unknown. The shared intro cases give each client's result for a chapter with its own end time. `ParityTest`'s TV-only intro cases check the disabled, hidden and ordered flags, and `SkipIntroTest` on the Shield covers the skip type.

## Differences being aligned

These differences are not intended. Each stays here until the pull request that closes it removes it.

Where this list says which way a difference closes, it follows the defaults in the plan that produced this record. Those defaults were adopted when Chris approved the plan on 2026-10-18, and he can override any of them.

- Next episode. The desktop takes the next video in the list (`MetaDetailsScreen.tsx`, `core/resume.ts`), so it can offer a special or an unreleased episode. The TV takes Core's choice for a series and drops it when it is an upcoming episode or the episode being played (`nextVideo` in `TvCore.kt`). The desktop will follow the TV, on card y7fun5gg6vfwm4.
- Resume position. The desktop applies the saved offset without checking that it belongs to the episode being played (`resumeAt` in `playback/session.ts`). The TV checks the video id (`resumePosition` in `TvCore.kt`). The desktop will follow the TV, on card y7fun5gg6vfwm4.
- Intro identity. The desktop asks TheIntroDB only for IMDb ids, any `tt` id with digits (`introIdentity` in `useIntroSkip.ts`). The TV also accepts TMDB ids, takes IMDb ids of seven or eight digits, and asks nothing for a series episode Core lists without a season and episode (`introIdentity` in `TvPlayer.kt`). Both will accept both, on card 7579y7dr2wnn32.
- Automatic intro skipping. On TV it runs only while Skip Intro is also on (`TvPlayer.kt`). On desktop it runs on its own setting alone (`useIntroSkip.ts`). Both will take the TV's meaning, on card 7579y7dr2wnn32, since automatic intro skipping invokes Skip Intro.
- Intro lookup with Skip Intro off. The desktop asks TheIntroDB whenever the chapters say nothing, whatever the setting (`useIntroSkip.ts`). The TV asks nothing while Skip Intro is off (`TvPlayer.kt`). On card 7579y7dr2wnn32, with automatic skipping.
- Add-on configuration. The TV accepts a pasted address, and builds an add-on's configure page, only from an HTTPS address ending in `/manifest.json` without credentials (`addonManifestUrl` in `TvAddons.kt`). The desktop builds the configure page from any transport URL its add-on network rule allows (`addonConfigurationUrl` in `core/addonConfiguration.ts`). Replacing a configuration differs too: the desktop reports a different or protected add-on, and a removal that did not take or was not saved (`installAddonConfiguration`), where the TV skips the removal silently and does not check it (`installPreviewedAddon` in `TvCore.kt`). Which rules both follow is undecided, on card fvy37x3vqs58vw.
- Add-on subtitles. The desktop remembers the chosen file's id and its position among files in its language (`describeAddonSubtitle` in `playback/tracks.ts`); the TV remembers only the language and takes the first file in it (`AddonSubtitleMemory` in `TvSubtitles.kt`). With Subtitles on and no embedded track in the Settings language, the TV loads an add-on file in that language (`TvPlayer.kt`); the desktop loads one only when the title remembers it (`restoreAddon` in `playback/tracks.ts`). Choosing an add-on file turns Subtitles on on desktop (`addAddonSubtitle` in `playback/session.ts`) and writes nothing on TV (`loadAddon` in `TvPlayer.kt`). On card x743rpz62t7pef.
- Default subtitle pick. With Subtitles on, the desktop takes the first embedded track in the Settings language, or the first track when no language is set (`preferredSubtitleTrack` in `player/subtitles.ts`). The TV hands the language to Media3 and takes its pick (`setPreferredTextLanguage` in `TvPlayer.kt`). What Media3 picks is unverified on the TV, since it needs the Shield. On card x743rpz62t7pef.
- End of playback. The desktop tells Core the video ended and stays on the paused player (`ended` in `playback/session.ts` and `playback/progress.ts`). The TV never tells Core and closes the player, unless Up Next takes over (`onPlaybackStateChanged` in `TvPlayer.kt`). On card r6yqaapkf3v75r.
- Source identity. The desktop resumes a remembered source only from the add-on that offered it, and marks a failed source by add-on, address, request headers and video (`sourceKey` in `core/sources.ts`, `core/resume.ts`, `MetaDetailsScreen.tsx`). The TV resumes the same address and headers from any add-on (`TvApp.kt`), and marks a failed source by video and address alone (`TvDetails.kt`). On card pgu8dr8hw6ut56.
- Core revision. The desktop runs the Core that `@stremio/stremio-core-web` was published from (`apps/desktop/package.json`). The TV runs the Core its `stremio-core-kotlin` bridge locks (`apps/android-tv/core/Cargo.lock`), an older revision. Whether they must match is undecided, on card qqentxqd5n5u9z.

## Consequences

A reviewer who finds the clients disagreeing in a rule both implement checks this list. A difference missing from it is a bug to fix on one side or an entry to add here with its reason.

Only two entries can be shared cases today, the unknown season and the Matroska chapter end time, because only they run through a function both suites can call with the same input. The others are not expressible there. The subtitle delay and seek steps are constants in each client's player interface, with no function to call. The subtitle scales are already per-platform entries in the settings schema. Remembered tracks and progress reports take each player's own track and position objects, which have no shared form. The desktop's refresh-rate choice is C++ in the shell, which neither suite runs, and the `kino_displaymode_test` CTest checks it.

The desktop half of the Matroska chapter case is true by construction: the desktop suite drops each chapter's end time before calling `introFromChapters`, as libmpv would, and no gate checks that `chapterPayload` passes on only the title and start time.
