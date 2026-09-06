# Remove torrent configuration from Settings

Issue #159 narrows Settings by removing the seeding and download-limit controls. This supersedes the requirement to expose those controls in [ADR 0015](0015-adopt-stream-server-with-a-locked-down-embedded-profile.md). The streaming engine retains its defaults and existing configuration; opening Settings no longer starts it to read configuration. Cache clearing remains available and preserves the engine configuration.

The Settings rendering check verifies that the controls are absent and opening the page does not connect to the player to start the helper. `pnpm macos:check-focus` also checks the rendered Settings controls in the production bundle; `pnpm macos:check-cache-clear` continues to verify configuration preservation.
