# Run the torrent engine as a child process on Android TV

## Status

Accepted

## Context

[ADR 0015](0015-adopt-stream-server-with-a-locked-down-embedded-profile.md) adopted stream-server's embedded profile and planned to validate it on the Shield "through its existing JNI surface". That surface runs upstream's full router, writes upstream's log files, and serves the API without a token. It fails the profile ADR 0015 itself requires. It also loads the engine, libtorrent and its C++ runtime into the app's own process, where a native crash takes the app down with it.

The Mac already runs Kino's own `kino-stream-engine` wrapper as a supervised helper process. The wrapper binds to loopback with a per-start token, sends sanitized logs to stderr, and stops when stdin closes. Android can run an executable shipped as a native library once the package installer extracts it, and a child process of the app runs under the app's own identity and sandbox.

One thing did not carry over. The engine's own HTTPS requests verify certificates through rustls-platform-verifier, which on Android calls the platform trust manager through a JVM. A child process has no JVM.

## Decision

The TV app runs the same `kino-stream-engine` the Mac ships, cross-compiled for arm64 from the same lock and patches. It is packaged as `lib/arm64-v8a/libkino_stream_engine.so`, with native libraries extracted, and started as a child process under the same contract as on the Mac. Each Kino process, guest or account, starts its own engine on the first torrent it plays, with its own cache.

- The engine's C++ dependencies are the releases the Mac's notices already review. libtorrent and Boost are at the versions Homebrew ships. OpenSSL comes from the checksummed openssl-src crate the TV Core already locks. `pnpm notices:check` fails if the Android build pins drift from those reviews.
- Kino exports Android's system certificate authorities to a PEM file and names it in `SSL_CERT_FILE`, the variable the Mac already uses for libtorrent's OpenSSL. Patch 0006 has the engine's own HTTPS clients read that file on Android instead of the platform verifier. User-added authorities stay excluded, as Android excludes them for apps.
- Patch 0007 leaves the RAR and 7z readers out of the Android engine. Their autocxx bindings cannot parse the NDK's sysroot from a Linux build host, and Kino's router never serves archives.
- The app's network security policy allows cleartext only to `127.0.0.1`, where the engine listens. Every other destination stays HTTPS-only.
- Core keeps the add-on's original torrent stream. Only Media3 receives the engine's URL, so no capability reaches Core's storage.
- Settings → Clear cache stops the engine before deleting its downloads, as the Mac does.

## Consequences

A crash in the engine ends only the engine. The next torrent starts a new one with a new token.

Extracting native libraries costs install space for all three native libraries, not only the engine's. The APK grows by the engine's size, about 27 MB stripped.

The TV and the Mac now run one engine from one source, so ADR 0022's networking limits and the profile patches apply to both. The Android build compiles libtorrent and OpenSSL with the NDK; CI caches the result by its pins.

`TorrentTest` on the Shield checks the engine end to end without a swarm. A private torrent's only source is a web seed the test serves on loopback. The gate checks that the engine opens it, reads it back byte for byte and by range, and refuses a request without the token. Media3 plays it through the same loopback address a torrent source gets. Clear cache stops the engine and deletes its downloads, and plain HTTP to anywhere else is refused.
