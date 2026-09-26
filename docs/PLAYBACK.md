# Playback contract

## Source handling

Kino shows every source returned by an installed add-on and asks the user to choose. The source list exposes the add-on name and any available resolution, codec, range, audio, size, and peer information. It preflights clear incompatibilities when the metadata is sufficient but may attempt unknown sources.

Core requests, manual manifest installation, and guest catalog setup require HTTPS. Development builds also allow HTTP to loopback addresses. Stored and synced add-ons follow the same policy. The macOS native transport follows HTTPS redirects for GET requests without request bodies or caller-supplied headers other than Accept. It checks each destination, rejects URL credentials and insecure destinations, and limits redirects to ten hops. Browser-only previews block redirects because browser fetch conceals the destination before following it. The Add-ons screen explains blocked transports and leaves them available for removal. Kino excludes Stremio's Local Files add-on without uninstalling it from the user's account.

`pnpm core:check-addon-transports` verifies the policy with the pinned Core WASM. `pnpm macos:check-addon-transports` checks actual Qt WebEngine requests against local HTTP and HTTPS fixtures, including a redirect to HTTP whose destination must receive no request.

| Source                               | Version-one behavior                                        |
| ------------------------------------ | ----------------------------------------------------------- |
| HTTPS direct media                   | Play internally                                             |
| HLS and DASH                         | Play internally                                             |
| Torrent `infoHash`                   | Required for 1.0 through an approved local streaming engine |
| External web URL                     | Open in the system browser after confirmation               |
| YouTube ID, FTP, RTMP, NZB, archives | Show as unsupported                                         |
| Live or DRM-protected source         | Show as unsupported                                         |

If initialization, decoding, or streaming fails, Kino saves progress, records a sanitized diagnostic, marks that source failed for the current selection session, and returns to the source list. It never switches to another source automatically. On desktop, a libmpv that cannot start leaves the shell running: every source reports that the player is unavailable, and the diagnostic summary shows the mpv version as unavailable. The `mpv_unavailable_create` and `mpv_unavailable_initialize` native tests make libmpv refuse to start and drive the item through loads, controls, and rendering.

## Video

Initial releases always output SDR. SDR sources render without range conversion. HDR10, HLG, Dolby Vision, and other supported 10-bit inputs are hardware-decoded and GPU tone-mapped to SDR. Dolby Vision profiles 5, 7, and 8 are accepted only when the platform produces correct SDR frames. Kino must reject green, washed-out, clipped, or otherwise incorrectly interpreted output.

On desktop, mpv tone-maps HDR10, HLG, and Dolby Vision profile 8's HDR10 or HLG base layer from the stream's metadata and never measures frames, so a frame maps the same on every desktop ([ADR 0026](adr/0026-tone-map-desktop-hdr-from-metadata.md)). HLG goes through BT.2100's 1000 cd/m² reference display into the HDR10 path, as on the TV, and profile 8's RPU is stripped so both clients show its base layer ([ADR 0027](adr/0027-tone-map-hlg-through-its-reference-display.md)). The `pixels-` cases in `pnpm macos:check-playback` read the drawn frame of a probe whose every pixel is a known code word, as HDR10, as HLG, and wrapped as Dolby Vision 8.1 and 8.4. Its neutral ramp must match the host reference in `scripts/test-support/tone-map-reference.mjs` within 0.03 and its in-gamut colours within 0.05; dropping the BT.2020 to BT.709 conversion misses by about 0.14. An SDR ramp in the same layout runs first as a control, proving a drawn frame can be read back at all. GitHub's hosted Mac runners often read every frame as black, and some read the SDR control yet draw HDR frames black, so CI sets `KINO_PLAYBACK_PIXELS=optional`. There a failed control reports the pixel cases as not run, and an all-black HDR frame as not verified; any other wrong colour still fails, and anywhere else nothing is excused. The pixel cases are therefore checked on desktops with a real GPU: `pnpm macos:check-playback` does so on a Mac by default, and the [Windows](validation/windows-hardware.md) and [Linux](validation/linux-hardware.md) validation records hold the runs on those systems. Profile 5 has no base layer this renderer can show without Dolby's reshaping, so the player refuses it by the profile mpv reports, and the `dv-p5-probe` case checks the refusal.

External source rows identify the destination host. Selecting one shows the complete HTTP or HTTPS URL for confirmation; Cancel or Escape keeps Kino on the details screen without opening anything. Approval opens the system browser, and a failed browser launch can be retried. URLs with credentials and unsupported source types stay disabled with a reason.

Kino never falls back to a software video decoder. If hardware decoding or GPU HDR-to-SDR conversion is unavailable, the source is unsupported. Audio decoding remains allowed.

| Input                            | Contract                                               |
| -------------------------------- | ------------------------------------------------------ |
| H.264 SDR                        | Hardware decode to SDR                                 |
| HEVC Main/Main10 SDR             | Hardware decode to SDR                                 |
| HDR10 or HLG                     | Hardware decode and GPU tone-map to SDR                |
| Dolby Vision profiles 5, 7, or 8 | Hardware decode and tone-map to correct SDR, or reject |
| AV1                              | Play only when hardware decoding is available          |
| Other video codecs               | Best effort only with a hardware decoder               |

MP4, Matroska, WebM, HLS, and DASH are first-class containers or transports. Other FFmpeg-supported inputs are best effort under the same hardware-video rule. Refresh-rate matching is available where supported but disabled by default on every platform. Desktop Settings does not offer it on Linux, where Wayland does not let an app change the output's mode. On the TV, Settings → Match frame rate switches the display to the video's rate, or the smallest whole multiple of it at the current resolution, and leaves a mode that already is one. The rate comes from the container when it states one, and otherwise from the first three seconds of frame times, snapped to the standard rates; Matroska states none. Playback holds while the TV changes mode, for up to five seconds, and the system's mode returns when playback ends. `FrameRateTest` checks the choice and the measurement, and switches the Shield's TV to 24 Hz for a 24 fps fixture and back. On macOS, Settings → Match refresh rate moves the display the window is on to a rate that is a whole multiple of mpv's container frame rate, at the same pixel size, choosing the multiple nearest the current rate: a 160 Hz monitor moves to 144 Hz for film rather than dropping to 24. A display already at such a rate, or offering none, stays as it is. Playback pauses for a moment while the display changes, and the display's own mode returns when playback stops, or when Kino exits, since the change is for Kino's session only. The `refresh-` case in `pnpm macos:check-playback` plays a 24 fps fixture on the primary display and checks the rate during and after against what that display offers; a CTest checks the choice.

## Audio

Kino supports AAC, AC-3, E-AC-3 including Atmos metadata, TrueHD, DTS, DTS-HD, DTS:X, FLAC, ALAC, and PCM when the selected platform backend supports the track and container.

Audio output is a device-local setting:

- **Auto**, the default, negotiates with the operating system and connected audio equipment. On TV it passes through lossless and object-based formats when the sink supports them; otherwise it decodes to compatible multichannel PCM or stereo. The Shield offers apps no decoder for AC-3, E-AC-3, DTS, or TrueHD, so when its surround setting or the sink rules out passthrough, Kino decodes those tracks with its bundled FFmpeg audio renderer, as recorded in [ADR 0019](adr/0019-decode-surround-audio-in-software-on-tv.md). A source with audio no renderer can play fails with a reason rather than playing silently.
- **Stereo** always decodes and downmixes to two-channel PCM inside Kino, and normalizes the level of what it produces.

The downmix follows ITU-R BS.775: front pairs at unity, centre and surround pairs at -3 dB, LFE dropped. Kino applies no static headroom cut, unlike the platform mixer's roughly -7.7 dB, and bends the rare all-channel peak through a soft limiter instead.

The Stereo path then normalizes loudness, because a theatrical mix anchors dialogue far below web video and Kino has no second, stereo-mastered track to select the way a streaming service does. Measured on the Shield, a TrueHD film ran about 12 dB below a speech-led YouTube clip through the same output at the same volume. Loudness is measured as ITU-R BS.1770-4 specifies, with K-weighting, 400 ms blocks, and the absolute and relative gates, integrated across the whole program rather than a sliding window so the gain does not ride the film's own dynamics. The gain moves toward a -19 LUFS target, bounded to +12 dB of boost and -6 dB of cut, and a peak limiter with instantaneous attack holds the result under -1 dBFS. Auto is untouched, since equipment that accepts surround is doing its own level management. `LoudnessNormalizerTest` checks the filters against the table in the standard and the measurement and gain against `scripts/test-support/loudness-reference.mjs`, a second implementation on the host.

On desktop, mpv's own filter chain does the same: libavfilter's `ebur128` measures the downmixed program to BS.1770-4, a gain stage follows, and a limiter holds peaks under -1 dBFS with its shortest attack. The shell reads the integrated loudness every half second after eight blocks and moves the gain toward the same target and bounds with the TV's rise and fall times. mpv's downmix keeps the BS.775 gains with its normalization turned off. The `stereo-loudness` cases in `pnpm macos:check-playback` play the TV probe once as written and once loud enough to reach the cut bound, and compare the player's measurement and settled gain with the host reference.

Audio preferences start with the Stremio profile language and may be overridden per device. TV Settings updates the current local Core profile's language preference without replacing its other settings or sending a remote account-settings update. The next playback uses it unless a remembered movie or show track choice takes precedence. `SettingsTest` verifies durable language writes and actual fullscreen track selection on the Shield.

## Subtitles

Kino supports embedded and external SRT, WebVTT, ASS, SSA, and PGS subtitles. The player exposes track selection, delay, size, and vertical position. On TV, the player's subtitle panel lists the media's own tracks and every file the add-ons offer for the source. Core asks the add-ons once the player reports the file's parameters. Kino fetches a chosen file itself, over HTTPS without redirects to plain HTTP and up to 4 MiB, recognises its format from the text, and side-loads it at the current position. The panel's delay moves every text track in quarter seconds, and size and position are remembered on the device. `SubtitleTest` drives a loopback add-on's SubRip file through the panel with the remote and checks the side-loaded track, its cue, and the delay against the live player. Subtitle language begins with the Stremio preference, while enabled state and device overrides are remembered locally. TV Settings offers subtitles on/off, off by default, and the preferred subtitle language; both apply to new playback. The Shield Settings and track checks cover these defaults and remembered subtitle Off.

Explicit audio and subtitle choices, including subtitle Off, are remembered on the current device per movie or show. Later episodes inherit the show's choice. A replacement source reuses it when the language, codec, and track variant match; an absent track falls back to the Settings preferences. Automatic choices do not overwrite a remembered choice. Track choices do not sync through the Stremio profile.

Text subtitles render as white glyphs with a black outline over the video. Nothing is filled behind them: no caption background, no window, and no drop shadow, whether the fill comes from Kino, a player default, or the device's own caption settings. ASS and SSA keep their positions, fonts, sizes, text colours, and italics, but an authored opaque box does not survive. On desktop, libmpv pins the caption colours and replaces `BorderStyle: 3` and the box and shadow colours through style overrides. On TV, Media3 renders with an explicit outline style, and Kino strips window colours and background spans from each cue before the player view draws it.

PGS and other bitmap subtitles are images. Any background they contain is part of those pixels, so no text style setting removes it, and Kino does not claim otherwise.

## Controls and lifecycle

Desktop provides Space or K for play/pause, arrow-key seeking, M for mute, and F for fullscreen. A click on the picture plays or pauses and a double click toggles fullscreen. The timeline shades how far the player has read ahead, from mpv's demuxer cache on desktop, and hovering it shows the time under the pointer, and leaving playback says that progress is being saved until the save finishes. The subtitle panel takes keyboard focus when it opens and returns it to its button when it closes. System media keys and the operating system Now Playing surface expose play, pause, seek, and metadata: MediaPlayer on macOS, MPRIS on Linux, and the System Media Transport Controls on Windows. On Linux, the `media_controls` CTest reaches Kino's MPRIS player from a second connection on a private session bus, as a desktop's media keys do, and checks the playback status, title, length and position it reports, that play, pause, stop and seek reach the player, and that a SetPosition meant for an earlier title is dropped. Kino prevents display and system sleep only while video is actively playing. If the computer goes to sleep anyway, Kino pauses first, so playback does not start again by itself when it wakes. On Linux Kino holds a logind delay lock so the pause lands before sleep; the `system-sleep` case in `pnpm macos:check-playback` delivers a will-sleep notification to the running player and expects it to pause.

TV playback is always fullscreen. A directional key or OK reveals hidden controls without activating anything behind them, and the playback surface keeps remote focus for the whole session, including each time the controls hide again. Back first closes the active menu or hides controls; when neither is open, it stops playback, saves progress, and returns to the media details screen.

Playback always runs at the normal rate. Neither presentation offers a playback-rate control, key, or remote action, and the TV player withholds the Media3 command its control view would list a Speed row for. Audio and subtitle selection stay reachable on both.

Playback resumes at saved progress, including when choosing a replacement source. Users can seek to the beginning to start over. Playback updates progress through Stremio Core when signed in and locally for guests.

Back, source failure, Up Next, window close, and application Quit share the same shutdown sequence. Kino pauses playback, captures the current position, sends the final progress and pause actions to Core, and waits for storage writes and pending library sync requests before unloading the player. The macOS shell keeps WebEngine alive until this sequence acknowledges completion. Kino also waits for writes caused by Unload, which can advance Continue Watching to the next episode. Failed local saves keep playback open for retry; failed account requests leave the locally saved progress available. On Android TV, a replaced Activity transfers its pending save to the process. The replacement Activity offers Retry and blocks another source until that save finishes.

The web interface process holds Core and this sequence, so on desktop its loss changes what the shell waits for. If that process ends, the shell stops playback, stops holding window close and Quit for a save nothing can acknowledge, and reloads the interface at once, since Qt WebEngine 6.11 leaves the dead page's accessibility tree pointing at freed memory until a new page replaces it and an accessibility client reading it then crashes Kino; three losses within a minute leave the failure screen instead of reloading again. A save request that goes unanswered for 15 seconds keeps the window open, and the next close proceeds. `pnpm macos:check-interface-recovery` kills the interface process, which DevTools names, and checks the reload, then has the shell end it and checks that Quit exits promptly. Linux CI runs it as well.

`pnpm core:check-shutdown` runs the pinned Core WASM with guest and synthetic account profiles, delayed storage acknowledgements, and delayed sync response bodies. `pnpm macos:check-shutdown` checks window close and application Quit against a running shell and libmpv using the legal H.264 fixture. Set `KINO_FIXTURES_DIR` when the fixtures are outside `build/fixtures`.

## Up Next

When Up Next is enabled and a next episode exists, Kino offers its source selector during the final two minutes of playback, capped at the final 10% for shorter videos. For example, the offer appears at 28:00 in a 30-minute episode and at 1:48 in a two-minute video. Seeking earlier hides the offer; seeking back into the ending restores it. If the duration is unknown, the offer waits for end-of-file.

The offer never starts playback automatically. Choosing it saves progress and opens the next episode's source selector, where the user must select a source.

On TV, `UpNextTest` runs the actual Core, Media3 player and remote controls with short and 30-minute fixtures. An MPEG-TS fixture without PCR is streamed through a controlled pipe to check unknown-duration playback and EOF. Delayed and failed storage writes check that choosing the next episode waits for both save phases and that Retry retains the destination.

## Intro behavior

Marker resolution uses this order:

1. An explicit Matroska opening-credit skip type or a recognized opening/intro chapter label.
2. A read-only TheIntroDB result whose media identity and duration pass strict matching checks.

The button exists only while the playhead is inside a trusted marker. Manual activation seeks to the marker end and shows no notice. Automatic skipping is off by default, triggers no more than once per segment in a playback session, and shows an “Intro skipped” notice with Undo. Undo seeks to the marker start and suppresses another automatic skip for that segment during the session.

The community client first checks the available versions for one exact positive runtime, then requests that runtime with unknown-runtime submissions excluded. It checks media identity in both responses. Missing or ambiguous matches, invalid responses, redirects, canceled requests, and responses above 64 KiB produce no marker. A five-second deadline covers both requests. The service does not return a stable version ID or echo the selected runtime, so this selection check cannot detect a release change between the two responses.

`pnpm intro:check`, included in `pnpm check`, bundles the production client and exercises it against HTTP fixtures. `pnpm macos:check-intro` also runs the bundle in Qt WebEngine, including a canceled response body.

The timeline highlights a trusted intro range. Seeking into that range restores the manual button; seeking outside it removes the button immediately.

On TV, `SkipIntroTest` drives the actual Core, Media3 player, timeline, and remote on the Shield. Legal Matroska fixtures cover explicit skip types, labels, indexed and unindexed tail chapters, conflicts, unsupported types, missing chapters, malformed text, and oversized metadata. An HLS fixture checks adaptive community resolution. The same gate checks automatic skipping, Undo suppression, seeking, interrupted bodies and ranges, the shared deadline, and strict community runtime and identity matching.

## Platform gates

Desktop uses libmpv through the initial shell fork. Android TV uses Media3 with Kino's own HDR-to-SDR shader, because Media3's tone mapping cannot run on the Shield ([ADR 0021](adr/0021-tone-map-hdr-in-kino-rather-than-media3.md)). On TV, HDR10 and HLG are accepted, HLG through BT.2100's reference display into the same path ([ADR 0027](adr/0027-tone-map-hlg-through-its-reference-display.md)), and so is Dolby Vision profile 8, whose cross-compatible base layer plays on an HEVC decoder: 8.1 as HDR10 and 8.4 as HLG. The other Dolby Vision profiles are rejected before a decoder is configured until each is measured on the device the way HDR10 and HLG were.
