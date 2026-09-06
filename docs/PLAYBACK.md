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

If initialization, decoding, or streaming fails, Kino saves progress, records a sanitized diagnostic, marks that source failed for the current selection session, and returns to the source list. It never switches to another source automatically.

## Video

Initial releases always output SDR. SDR sources render without range conversion. HDR10, HLG, Dolby Vision, and other supported 10-bit inputs are hardware-decoded and GPU tone-mapped to SDR. Dolby Vision profiles 5, 7, and 8 are accepted only when the platform produces correct SDR frames. Kino must reject green, washed-out, clipped, or otherwise incorrectly interpreted output.

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

MP4, Matroska, WebM, HLS, and DASH are first-class containers or transports. Other FFmpeg-supported inputs are best effort under the same hardware-video rule. Refresh-rate matching is available where supported but disabled by default on every platform.

## Audio

Kino supports AAC, AC-3, E-AC-3 including Atmos metadata, TrueHD, DTS, DTS-HD, DTS:X, FLAC, ALAC, and PCM when the selected platform backend supports the track and container.

Audio output is a device-local setting:

- **Auto**, the default, negotiates with the operating system and connected audio equipment. On TV it passes through lossless and object-based formats when the sink supports them; otherwise it decodes to compatible multichannel PCM or stereo. The Shield offers apps no decoder for AC-3, E-AC-3, DTS, or TrueHD, so when its surround setting or the sink rules out passthrough, Kino decodes those tracks with its bundled FFmpeg audio renderer, as recorded in [ADR 0019](adr/0019-decode-surround-audio-in-software-on-tv.md). A source with audio no renderer can play fails with a reason rather than playing silently.
- **Stereo** always decodes and downmixes to two-channel PCM inside Kino.

Audio preferences start with the Stremio profile language and may be overridden per device.

## Subtitles

Kino supports embedded and external SRT, WebVTT, ASS, SSA, and PGS subtitles. The player exposes track selection, delay, size, and vertical position. Subtitle language begins with the Stremio preference, while enabled state and device overrides are remembered locally.

Explicit audio and subtitle choices, including subtitle Off, are remembered on the current device per movie or show. Later episodes inherit the show's choice. A replacement source reuses it when the language, codec, and track variant match; an absent track falls back to the Settings preferences. Automatic choices do not overwrite a remembered choice. Track choices do not sync through the Stremio profile.

Text subtitles render as white glyphs with a black outline over the video. Nothing is filled behind them: no caption background, no window, and no drop shadow, whether the fill comes from Kino, a player default, or the device's own caption settings. ASS and SSA keep their positions, fonts, sizes, text colours, and italics, but an authored opaque box does not survive. On desktop, libmpv pins the caption colours and replaces `BorderStyle: 3` and the box and shadow colours through style overrides. On TV, Media3 renders with an explicit outline style, and Kino strips window colours and background spans from each cue before the player view draws it.

PGS and other bitmap subtitles are images. Any background they contain is part of those pixels, so no text style setting removes it, and Kino does not claim otherwise.

## Controls and lifecycle

Desktop provides Space or K for play/pause, arrow-key seeking, M for mute, and F for fullscreen. System media keys and the operating system Now Playing surface expose play, pause, seek, and metadata. Kino prevents display and system sleep only while video is actively playing.

TV playback is always fullscreen. A directional key or OK reveals hidden controls without activating anything behind them, and the playback surface keeps remote focus for the whole session, including each time the controls hide again. Back first closes the active menu or hides controls; when neither is open, it stops playback, saves progress, and returns to the media details screen.

Playback always runs at the normal rate. Neither presentation offers a playback-rate control, key, or remote action, and the TV player withholds the Media3 command its control view would list a Speed row for. Audio and subtitle selection stay reachable on both.

Playback resumes at saved progress, including when choosing a replacement source. Users can seek to the beginning to start over. Playback updates progress through Stremio Core when signed in and locally for guests.

Back, source failure, Up Next, window close, and application Quit share the same shutdown sequence. Kino pauses playback, captures the current position, sends the final progress and pause actions to Core, and waits for storage writes and pending library sync requests before unloading the player. The macOS shell keeps WebEngine alive until this sequence acknowledges completion. Failed local saves keep playback open for retry; failed account requests leave the locally saved progress available.

`pnpm core:check-shutdown` runs the pinned Core WASM with guest and synthetic account profiles, delayed storage acknowledgements, and delayed sync response bodies. `pnpm macos:check-shutdown` checks window close and application Quit against a running shell and libmpv using the legal H.264 fixture. Set `KINO_FIXTURES_DIR` when the fixtures are outside `build/fixtures`.

## Up Next

When Up Next is enabled and a next episode exists, Kino offers its source selector during the final two minutes of playback, capped at the final 10% for shorter videos. For example, the offer appears at 28:00 in a 30-minute episode and at 1:48 in a two-minute video. Seeking earlier hides the offer; seeking back into the ending restores it. If the duration is unknown, the offer waits for end-of-file.

The offer never starts playback automatically. Choosing it saves progress and opens the next episode's source selector, where the user must select a source.

## Intro behavior

Marker resolution uses this order:

1. An explicit Matroska opening-credit skip type or a recognized opening/intro chapter label.
2. A read-only TheIntroDB result whose media identity and duration pass strict matching checks.

The button exists only while the playhead is inside a trusted marker. Manual activation seeks to the marker end and shows no notice. Automatic skipping is off by default, triggers no more than once per segment in a playback session, and shows an “Intro skipped” notice with Undo. Undo seeks to the marker start and suppresses another automatic skip for that segment during the session.

The timeline highlights a trusted intro range. Seeking into that range restores the manual button; seeking outside it removes the button immediately.

## Platform gates

Desktop uses libmpv through the initial shell fork. Android TV prototypes Media3 hardware decoding and OpenGL HDR-to-SDR conversion on the NVIDIA Shield. Media3 remains the TV backend only if it satisfies this entire contract; otherwise the TV playback layer changes to libmpv without changing the rest of the native Kotlin application.
