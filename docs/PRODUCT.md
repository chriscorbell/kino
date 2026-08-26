# Kino product contract

## Product

Kino is a public, GPL-3.0-only media client for the Stremio ecosystem. It uses Stremio accounts, add-ons, catalogs, library state, and playback progress while owning its interface and platform experience. It does not operate a Kino account service, catalog, analytics system, or cloud backend.

The mockup is the visual contract, not production source. Kino will preserve its restrained dark design, hierarchy, spacing, and interaction language while replacing placeholder media with real metadata and adding complete loading, empty, error, accessibility, responsive, and television states.

## Platform order

1. macOS 14 or newer, developed and validated first on Apple Silicon.
2. Android TV, validated on an NVIDIA Shield over network ADB.
3. Windows and Linux.
4. Apple TV after the earlier platforms are stable.

The first public macOS package will be a signed and notarized universal build for Apple Silicon and Intel. Android TV will initially use a signed sideloadable APK. Windows and Linux packaging follow after the Mac and TV foundations are proven.

## Version-one experience

- Sign in with Stremio or continue with a device-local guest profile.
- Open account creation in the system browser. Send passwords only to Stremio during authentication and store only the resulting auth token, in device-local storage readable by the signed-in user account alone.
- On TV, prefer a QR or device-link flow rather than remote-entered passwords.
- Keep guest state separate from account state. Never merge or overwrite it implicitly.
- Provide Home, Discover, Search, Library, media details, source selection, playback, add-on management, and Settings.
- Use the add-ons synced to the Stremio account, ship only official defaults, and allow configuration, removal, and manual manifest installation.
- Require HTTPS for remote add-ons. Permit HTTP only on loopback addresses for development.
- Preserve explicit source selection. Kino will not rank, choose, or silently switch sources.
- Resume the previous source only when it remains valid. Otherwise show source selection.
- Show Up Next near an episode ending, but accepting it opens the next episode's source selector.
- Sync library and playback progress through Stremio when signed in and keep equivalent state locally for guests.

## Presentation

Desktop and TV share terminology, visual rules, and design tokens but use separate presentations. Desktop is designed for pointer and keyboard. TV is designed for a directional remote, visible focus, larger targets, and ten-foot spacing. All TV playback is fullscreen.

Version one is dark-only and English-only, but every visible string begins in locale files. It must provide keyboard access, semantic labels, visible focus, reduced-motion support, AA contrast, and usable interface scaling.

Desktop playback occupies the main window rather than a detached player. Ordinary system fullscreen is supported; picture-in-picture and multiple windows are deferred. Playback continues while the app is minimized or unfocused. Closing the window or quitting stops playback and saves progress. Android TV stops and saves when Kino moves to the background.

## Skip Intro

Skip Intro is built in and enabled by default. Kino first uses explicit opening-credit metadata or recognized chapter labels, then performs a read-only TheIntroDB lookup. A button is shown only while the playhead is inside a trusted intro segment, disappears after the segment, and returns when the user seeks back into it.

Manual skipping seeks to the marker's end without showing a notice. Automatic intro skipping is a separate setting that is disabled by default. When enabled, an automatic skip shows a brief “Intro skipped” notice with Undo. Undo returns to the intro start and suppresses automatic skipping for that segment during the current playback session.

Kino favors a missing button over skipping dialogue. Version one does not run local audio fingerprinting and does not provide any surface for submitting or correcting intro timestamps.

## Privacy and diagnostics

Kino sends no product analytics, crash reports, or diagnostic telemetry. Verbose local logging is enabled by default, sanitized, and rotated across five files of at most 10 MB each. Logs must never contain credentials, authentication tokens, complete stream URLs, or other embedded secrets.

Desktop Settings provides Open Log Folder and Copy Diagnostic Summary. Android diagnostics use Logcat and must be observable over network ADB on the test Shield.

## Distribution and updates

Official releases are published through GitHub with signatures and checksums. Kino checks once daily, prompts when an update exists, and never installs silently. Sideloaded TV builds notify the user and open the release page. Kino settings remain device-local and do not sync.

The Kino name and logo identify official builds. The GPL source remains modifiable and distributable, but public redistributed builds must rebrand and preserve all upstream licenses and notices.

## Deferred work

- Casting, downloads, offline playback, local-file playback, and external players.
- Calendar, notifications, live-TV behavior, and DRM playback.
- Picture-in-picture, detached player windows, and multiple application windows.
- Community add-on discovery or a Kino-curated add-on catalog.
- Intro-marker submissions, corrections, and local fingerprint detection.
- Native HDR or Dolby Vision output. Initial releases always produce SDR.
- Custom keyboard shortcuts, playback speed, frame stepping, and video filters.
- Product analytics, remote crash collection, and cloud-synced Kino settings.
