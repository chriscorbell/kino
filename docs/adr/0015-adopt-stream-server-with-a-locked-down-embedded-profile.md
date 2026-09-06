# Adopt stream-server with a locked-down embedded profile

The requirement to expose seeding and download-limit controls is superseded by [ADR 0020](0020-remove-torrent-configuration-from-settings.md).

The open torrent engine gate from ADR 0013 passed a hands-on macOS audit of `stremio-native/stream-server` (MIT, Rust, libtorrent-rasterbar backend, BSD-3): its embedded library profile binds the Stremio-compatible HTTP API to loopback only, serves byte-identical original media over HTTP ranges (cold start to first bytes ~9 s, cold deep seek ~12 s via piece reprioritization, ~80–120 MB resident while streaming, 10 GB capped cache with a cleaner), and its dependencies are pinned by checksummed lock file. Kino will embed it as a pinned, built-from-source component using that embedded profile — never the standalone binary, whose defaults (bind on all interfaces, SSDP, background auto-update, runtime FFmpeg download) violate Kino's network-exposure and no-unverified-blob rules.

Conditions carried into integration: pin the audited commit, keep FFmpeg setup and auto-update disabled (Kino never transcodes), point the engine at a Kino-owned cache directory, and surface the seeding and download-limit settings (both default to on/unlimited). Known upstream defects to track: the advertised pure-Rust librqbit backend does not compile and is unmaintained, linking against a shared system libtorrent needs a one-line `from_hex` patch (upstream assumes static vcpkg builds), and the engine trusts BitTorrent resume state without checking that cache files still exist. Android validation of the same engine happens with the Phase 4 Shield prototype through its existing JNI surface.

References:

- [stream-server](https://github.com/stremio-native/stream-server) (audited at commit f585ab6)
- [Gate torrent support on an open streaming engine](0013-gate-torrent-support-on-an-open-streaming-engine.md)
