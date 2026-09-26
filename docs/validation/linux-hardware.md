# Linux hardware validation

On 2026-09-26 Kino ran the desktop probes and the playback gate on two Linux machines, with the change in #257, in two forms: the shell built on Ubuntu 26.04 by the steps in the README, and the `Kino-x86_64.flatpak` bundle from the Flatpak workflow.

- A laptop with an Intel Core Ultra 9 185H and its Arc iGPU, on Ubuntu 26.04.1 with GNOME 50 on Wayland, at 3200 × 2000, 120 Hz and a scale of 5/3. The Ubuntu build used Qt 6.10.2, libmpv 0.41.0 and Intel's media driver 26.1.2.
- A headless server with a Radeon 780M, running the checks in an Ubuntu 26.04 container with the GPU's render node passed in and a headless Weston drawing on the GPU through Mesa 26.0.8.

## Result

Both forms passed all 26 playback fixtures on the laptop, and the Ubuntu build did on the server, decoding through VA-API: H.264, HEVC SDR, HDR10 at 1080p and 2160p, HLG, and AV1; FFV1 rejected as software-only; ALAC, DTS, PCM, E-AC-3 and AC-3 audio; embedded, authored and external subtitles; chapters; the pause before sleep; Stereo loudness normalization; drawn HDR10 and Dolby Vision 8.1 pixels matching the tone-map reference; Dolby Vision 5 rejected; refresh-rate matching, which leaves the display as it is on Linux; and broken or missing sources rejected.

On the laptop both forms also passed launch and the second-launch hand-over, scale, focus, resume, community intros, seasons, fullscreen, volume, audio, track choices, the web console, navigation, interface recovery, TLS, request headers, shutdown, and add-on transports. The Flatpak, which carries the torrent engine, passed the engine start, the engine UI, cache clear with torrent replay, and engine retry as well. The Flatpak held its logind sleep delay lock through Flatpak's D-Bus proxy.

Three things the runs found:

- mpv measured each HDR frame's peak where the GPU has compute shaders, which Linux drivers have and the Mac's OpenGL does not. The probe's ramp reaches the top of the PQ range, so Linux drew it about 40% darker than the Mac and failed the pixel checks. Every desktop now maps from the stream's metadata ([ADR 0026](../adr/0026-tone-map-desktop-hdr-from-metadata.md)).
- Ubuntu does not install Intel's VA-API driver, and without it Kino refuses every video, as the contract requires. The README's Linux steps now say so. The Flatpak runtime installs its Intel driver extension by itself.
- The interface recovery probe crashed the web process with DevTools' `Page.crash`, which does nothing on Linux. It now kills the process instead (#259), and Linux CI runs it. In the Flatpak, DevTools gives the process's number inside the sandbox, so the probe finds the host process by its namespace numbers (#261).

On the laptop, `pnpm linux:check-sleep` (#260) suspended the machine through logind for 20 seconds while Kino played, with both the Ubuntu build and the Flatpak. Kino paused 0 ms into the sleep each time, so the pause landed before the machine slept, and the Flatpak received logind's notice through Flatpak's D-Bus proxy.

Not covered: sound heard at the speakers, GNOME's media controls seen on screen (the `media_controls` CTest covers the MPRIS surface they read), and signing in to a real Stremio account.

## Repeating it

The checks need the signed-in desktop session, which an SSH session does not have. Read the session's environment from the user manager, `systemctl --user show-environment`, and export `WAYLAND_DISPLAY`, `DISPLAY`, `XAUTHORITY`, `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` before starting anything. Hold `gnome-session-inhibit --inhibit idle:suspend sleep 7200` in the background so the screen does not lock partway, since a locked session stops drawing. Run it beside the checks, not as their parent.

The machine needs node, ffmpeg, ffprobe and openssl, a clone, and fixtures; the Dolby Vision fixtures need `dovi_tool` and `mkvmerge` to make but are reused when present, so copying `build/fixtures` from a Mac is enough. Point `KINO_FIXTURES_DIR` at them.

For the Ubuntu build, follow the README and set `KINO_APP_BINARY` to `build/linux/Kino`. For the Flatpak, install the bundle with `flatpak install --user`, after `org.kde.Platform//6.11` from Flathub, and set `KINO_APP_BINARY` to `scripts/test-support/kino-flatpak.sh`, which runs the installed app with the probe's settings. Set `XDG_DATA_HOME` to `~/.var/app/com.chriscorbell.Kino/data` so the web console probe finds the sandbox's log. A killed Kino leaves the portal's empty WebEngine sandboxes behind; clear them between probes (`pgrep -f 'bwrap --args'`) on a machine that runs no other Flatpak apps.

Then run each `scripts/check-*.mjs` with node and the `.sh` probes with bash. A server without a display can run the same checks under `weston --backend=headless --renderer=gl` with `QT_QPA_PLATFORM=wayland`, in a container given `/dev/dri/renderD128` and the render and video groups; the Flatpak needs the container to be privileged.
