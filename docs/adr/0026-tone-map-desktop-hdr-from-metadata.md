# Tone map desktop HDR from its metadata

## Status

Accepted

## Context

The desktop shell hands tone mapping to mpv. Left at its default, mpv measures the peak and average brightness of every frame and maps each scene to what it measured, but only where the GPU offers compute shaders and storage buffers. The Mac's OpenGL 4.1 offers neither, so on the Mac mpv maps from the stream's metadata. Linux drivers offer both.

The first Linux hardware run showed the difference. The probe's neutral ramp climbs to the top of the PQ range while its metadata says 1000 cd/m², so the measured peak was ten times the stated one and the whole frame came out about 40% darker than on the Mac. The playback gate failed there on HDR10 and Dolby Vision profile 8. Real films rarely exceed their metadata by that much, but measuring still makes the same film look different on each desktop, and brightness drifts as the measured peak follows the scene.

The TV maps from a fixed source peak ([ADR 0021](0021-tone-map-hdr-in-kino-rather-than-media3.md)), and the gate compares every platform against the same host reference.

## Decision

Every desktop sets `hdr-compute-peak=no`. mpv tone maps from the stream's HDR metadata, the same way on the Mac, Windows and Linux, and never measures frames.

## Consequences

A given frame maps the same on every desktop, and the `pixels-` cases of the playback gate hold Windows and Linux to the reference the Mac already meets. A file whose metadata overstates its real peak looks dimmer than scene measurement would show it, as it already did on the Mac and the TV.

The Mac cannot measure frames at all, so a regression that turned measurement back on would pass there. The gate catches it on Linux hardware.
