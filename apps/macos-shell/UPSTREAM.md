# Native shell provenance

Kino's macOS shell is a narrow GPL-3.0-only fork of the player integration approach in [`Stremio/stremio-shell`](https://github.com/Stremio/stremio-shell), audited at commit `c3a8bcbf857d5569b6ae7444ead0dc0a0814888b` (2026-03-27).

Only the libmpv/Qt Quick rendering seam was carried forward and substantially rewritten for Qt 6, Apple Silicon, Kino's native bridge, hardware-only decoding, SDR output, and sanitized local diagnostics. Kino does not include Stremio's QML interface, branding, updater, certificates, binaries, or downloaded streaming service.
