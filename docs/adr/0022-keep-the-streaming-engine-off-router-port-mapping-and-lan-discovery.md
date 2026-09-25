# Keep the streaming engine off router port mapping and LAN discovery

## Status

Accepted

## Context

[ADR 0015](0015-adopt-stream-server-with-a-locked-down-embedded-profile.md) adopted stream-server in an embedded profile because the standalone binary's defaults exposed more of the machine than Kino accepts: listening on every interface, SSDP, background updates. The embedded profile kept the HTTP API on loopback, but the libtorrent session underneath still ran upstream's hard-coded networking. `enable_upnp` and `enable_natpmp` were always on, and local service discovery followed a default that was on.

In practice, starting a helper made the Mac multicast an Internet Gateway Device search and hold the SSDP port, which is the first step of asking the home router to forward an inbound port to it. Loading a torrent made it hold the local service discovery port. Local service discovery periodically multicasts the info hash of every loaded public torrent to the whole local network. Nothing in Kino told the user either was happening, and neither is needed to stream.

## Decision

Kino's engine patch turns off UPnP, NAT-PMP and local service discovery in the libtorrent session, regardless of stored engine configuration. DHT and peer exchange keep their upstream behavior. The BitTorrent listener still binds its usual port range, so a user who forwards a port by hand still receives incoming peers.

## Consequences

Streaming depends on outgoing peer connections, which is how most sources on a home network reach the swarm anyway. A machine behind NAT without a manual forward receives fewer incoming connections, which matters for seeding more than for playback.

`pnpm engine:check-profile` asserts from the running helper's own UDP sockets, with a torrent loaded, that neither the SSDP listener nor the local service discovery listener exists. Before the patch the check fails on the SSDP socket. NAT-PMP is switched off by the same patch line but leaves no socket the check can observe.
