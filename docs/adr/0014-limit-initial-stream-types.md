# Limit initial stream types

Kino 1.0 will play HTTPS direct media, HLS, DASH, and torrent sources. External web destinations open in the system browser only after confirmation. YouTube IDs, FTP, RTMP, NZB, archive-backed media, live-specific playback, and DRM are deferred. Unsupported types remain visible when returned by an add-on and explain why they cannot be played rather than failing silently.
