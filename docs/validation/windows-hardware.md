# Windows hardware validation

On 2026-09-26 the Windows portable build from `main` (the Windows workflow's `Kino-windows-x64-with-engine`, with the cross-built libmpv, #251) ran every desktop probe and the playback gate on a Windows 11 Pro 26200 PC with a Ryzen 7 7800X3D, its Radeon iGPU, and an RTX 3080. The active display was a virtual display driver at 3840 × 2160 and 120 Hz.

## Result

The playback gate passed all 26 fixtures with hardware decoding through D3D11VA: H.264, HEVC SDR, HDR10 at 1080p and 2160p, HLG, and AV1, which the RTX 3080 decodes; FFV1 rejected as software-only; ALAC, DTS, PCM, E-AC-3 and AC-3 audio; embedded, authored and external subtitles; chapters; the pause before sleep; Stereo loudness normalization; drawn HDR10 and Dolby Vision 8.1 pixels matching the tone-map reference; Dolby Vision 5 rejected; refresh-rate matching, which left the 120 Hz display as it was since 120 is a multiple of 24; and broken or missing sources rejected.

Every probe the macOS job runs passed as well: launch and the second-launch hand-over, the engine and its embedded profile, cache clear and torrent replay, scale, focus, resume, community intros, seasons, fullscreen, volume, audio, track choices, the web console, navigation, interface recovery, TLS, the engine UI, engine retry, request headers, shutdown, and add-on transports.

A later run of the build from #257, which tone maps HDR from its metadata on every desktop, passed all 26 fixtures again, and the interface recovery probe as #259 changed it.

Two things the run found were in the checks, not in Kino:

- The SDR pixel control was lossless H.264, the High 4:4:4 Predictive profile, which VideoToolbox decodes and D3D11VA does not, so the hardware-only player rightly refused it. The control only has to read back as a rising ramp, so it is now plain 4:2:0 H.264.
- FFmpeg's Schannel verifies HTTPS against the Windows certificate store and takes no CA file, so Kino's exported trust anchors have no part on Windows. The TLS probe checks there only that an unknown authority is refused.

Not covered: sound heard at the speakers, the System Media Transport Controls surface, and signing in to a real Stremio account.

## Repeating it

The probes need the desktop session, which an SSH session does not have. From SSH, a scheduled task with an interactive principal (`New-ScheduledTaskPrincipal -LogonType Interactive`) runs a command file in the signed-in session, and that file writes its own log. The machine needs node, ffmpeg and ffprobe on `PATH`, `openssl` (Git for Windows ships one in `C:\Program Files\Git\usr\bin`), a clone with `pnpm install` and `pnpm --filter @kino/desktop build` done, and fixtures; the Dolby Vision fixtures need `dovi_tool` and `mkvmerge` to make but are reused when present, so copying them from a Mac is enough. Extract the portable build somewhere other than beside a clone named `kino`: Windows paths ignore case, so its `Kino` folder and the clone are the same directory. Set `KINO_APP_BINARY` to the portable folder's `Kino.exe` and `KINO_ENGINE_BINARY` to its `kino-stream-engine.exe`, then run each `scripts/check-*.mjs` with node and the `.sh` probes with Git's bash; pnpm would run the shell scripts through cmd.exe.
