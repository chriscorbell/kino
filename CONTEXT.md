# Kino

Kino is a public media client that works with the Stremio ecosystem while owning its interface and platform experience.

## Language

**Kino**:
A Stremio-compatible media client with an original interface for desktop and television devices.
_Avoid_: Stremio skin, Stremio UI fork

**Stremio-compatible**:
Able to use Stremio accounts, add-ons, catalogs, streams, library state, and playback progress through Stremio's public core and protocols.
_Avoid_: Stremio clone

**Add-on**:
A provider that follows the Stremio Addon Protocol and supplies one or more catalogs, media records, streams, or subtitles. Kino uses the add-ons attached to a Stremio account and does not operate a separate add-on catalog.
_Avoid_: Plugin, channel

**Source**:
A playable option returned by an add-on for a particular movie or episode. Kino asks the user to select a source rather than ranking and choosing one automatically.
_Avoid_: File, provider

**Streaming engine**:
The replaceable local component that turns torrent and other non-direct sources into a seekable stream for Kino's player. It does not own browsing, source selection, or the playback interface.
_Avoid_: Player, Stremio Core

**Guest profile**:
The device-local Stremio-compatible state used without signing in. Its library and playback progress remain separate from every signed-in account and are never merged automatically.
_Avoid_: Temporary account, anonymous account

**Up Next**:
The end-of-episode action that opens the next episode's source selector. It never starts another source automatically.
_Avoid_: Autoplay

**Stereo downmix**:
Playback that converts a multichannel audio track to two output channels inside Kino's player. It lets stereo equipment play sources whose selected track uses surround audio.
_Avoid_: Stereo track, transcoding

**SDR output**:
Kino's initial video-output policy. SDR sources render unchanged, while supported HDR, HLG, and Dolby Vision inputs are tone-mapped to SDR before display.
_Avoid_: HDR passthrough, Dolby Vision output

**TV playback**:
A playback session in the TV presentation. TV playback always occupies the full display rather than sharing space with browsing UI.
_Avoid_: Embedded player, windowed playback

**Desktop presentation**:
Kino's pointer-and-keyboard interface for macOS, Windows, and Linux.
_Avoid_: Desktop skin

**TV presentation**:
Kino's remote-first interface for Android TV, built from the same design language as the desktop presentation.
_Avoid_: Stretched desktop UI, TV skin

**Intro segment**:
The detected time range at the start of an episode that contains recurring opening material.
_Avoid_: Intro chapter

**Trusted intro segment**:
An intro segment whose marker meets Kino's source, confidence, and media-duration checks. Skip Intro is available only while the playhead is inside this segment.
_Avoid_: Detected intro, known intro

**Intro marker**:
The start and end boundaries for an intro segment, together with their source and confidence. Kino may obtain a marker from media metadata or a read-only community lookup.
_Avoid_: Intro timestamp

**Skip Intro**:
The user-invoked action that jumps playback to the end of the current intro segment. It is available by default when Kino has enough confidence in the segment.
_Avoid_: Auto-skip

**Automatic intro skipping**:
An optional playback behavior that invokes Skip Intro without user input. It is disabled by default.
_Avoid_: Skip Intro

**Kino setting**:
A device-local preference owned by Kino, such as appearance, playback, logging, or Skip Intro behavior. Kino settings do not belong to the Stremio profile and do not sync between devices.
_Avoid_: Profile setting, account setting

**Diagnostic log**:
A rotating, device-local record of Kino activity used to investigate bugs and crashes. Diagnostic logs never leave the device automatically and never contain credentials.
_Avoid_: Analytics, telemetry

**Local cache**:
Bounded, disposable artwork, metadata, and subtitle data. Clearing it does not remove authentication, profiles, library state, progress, add-ons, or Kino settings.
_Avoid_: Download, offline library
