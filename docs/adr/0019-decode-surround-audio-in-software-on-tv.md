# Decode surround audio in software on TV when passthrough is unavailable

## Status

Accepted

## Context

The NVIDIA Shield exposes no MediaCodec decoder for AC-3, E-AC-3, DTS, or TrueHD to applications; those formats reach the speakers only through HDMI passthrough, which Android offers an app only when the device's surround setting and the connected sink both allow it. A Shield set to manual surround with no formats enabled advertises PCM alone, and Media3 then marks an E-AC-3 track unsupported and deselects it. The result was video with no sound and no audio track to choose, while the playback contract promises decoded PCM or stereo whenever passthrough is unavailable and forbids only software video decoding.

Media3 publishes its FFmpeg audio decoder as source, not as a Maven artifact.

## Decision

Kino builds Media3's FFmpeg audio renderer for Android TV from the pinned Media3 release and a pinned FFmpeg tag, verified by checksum, with FFmpeg configured LGPL-only: the AC-3, E-AC-3, DTS, TrueHD, and MLP decoders, static libraries for arm64, no demuxers, no video, no GPL or non-free components. The renderer runs in extension mode ON, after the platform renderers, so passthrough and MediaCodec decoders keep priority and FFmpeg only handles what they refuse.

A source whose audio tracks exist but cannot be selected by any renderer is reported as a playback failure rather than played silently.

## Consequences

`scripts/build-android.py` clones and builds FFmpeg with the NDK and caches the result; CI carries that cache. The APK bundles FFmpeg under the LGPL 2.1 and the Media3 module sources under Apache 2.0, with both notices in the app. Updating either pin is a deliberate change to the checksums in the build script, as ADR 0008 requires.

Under the default Auto setting, decoded multichannel PCM goes to the platform as is, and lossless passthrough remains preferred wherever the device offers it. The Stereo setting instead refuses passthrough and folds every track to two channels inside Kino with its own matrix: fronts at unity, centre and surrounds at -3 dB, LFE dropped, no static headroom cut, and a soft limiter for the rare simultaneous peak. The platform mixer's downmix applies a fixed cut of roughly -7.7 dB, which is why surround films sound quiet on stereo sets in other clients.
