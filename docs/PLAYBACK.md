# Playback contract

## Source handling

Kino shows every source returned by an installed add-on and asks the user to choose. The source list exposes the add-on name and any available resolution, codec, range, audio, size, and peer information. It preflights clear incompatibilities when the metadata is sufficient but may attempt unknown sources.

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

- **Auto**, the default, negotiates with the operating system and connected audio equipment. On TV it passes through lossless and object-based formats when the sink supports them; otherwise it decodes to compatible multichannel PCM or stereo.
- **Stereo** always decodes and downmixes to two-channel PCM inside Kino.

Audio preferences start with the Stremio profile language and may be overridden per device.

## Subtitles

Kino supports embedded and external SRT, WebVTT, ASS, SSA, and PGS subtitles. ASS and SSA styling and positioning are retained where the player permits. The player exposes track selection, delay, size, and vertical position. Subtitle language begins with the Stremio preference, while enabled state and device overrides are remembered locally.

## Controls and lifecycle

Desktop provides Space or K for play/pause, arrow-key seeking, M for mute, and F for fullscreen. System media keys and the operating system Now Playing surface expose play, pause, seek, and metadata. Kino prevents display and system sleep only while video is actively playing.

TV playback is always fullscreen. Back first closes the active menu or hides controls; when neither is open, it stops playback, saves progress, and returns to the media details screen.

Continue Watching resumes at saved progress. Media details also offers Start Over. Playback updates progress through Stremio Core when signed in and locally for guests.

## Intro behavior

Marker resolution uses this order:

1. An explicit Matroska opening-credit skip type or a recognized opening/intro chapter label.
2. A read-only TheIntroDB result whose media identity and duration pass strict matching checks.

The button exists only while the playhead is inside a trusted marker. Manual activation seeks to the marker end and shows no notice. Automatic skipping is off by default, triggers no more than once per segment in a playback session, and shows an “Intro skipped” notice with Undo. Undo seeks to the marker start and suppresses another automatic skip for that segment during the session.

The timeline highlights a trusted intro range. Seeking into that range restores the manual button; seeking outside it removes the button immediately.

## Platform gates

Desktop uses libmpv through the initial shell fork. Android TV prototypes Media3 hardware decoding and OpenGL HDR-to-SDR conversion on the NVIDIA Shield. Media3 remains the TV backend only if it satisfies this entire contract; otherwise the TV playback layer changes to libmpv without changing the rest of the native Kotlin application.
