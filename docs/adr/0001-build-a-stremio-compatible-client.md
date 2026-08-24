# Build a Stremio-compatible client

Kino will use Stremio's public core, identity, and protocols while owning its UI and platform integration. It will not create a Kino account or authentication backend. Upstream components stay dependencies where possible, and Kino will fork them only when a required change cannot live in Kino itself. This preserves account and add-on compatibility without inheriting Stremio's existing interface or treating several platform-specific Stremio applications as one source tree.
