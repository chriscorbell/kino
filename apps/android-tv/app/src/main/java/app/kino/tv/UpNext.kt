package app.kino.tv

import com.stremio.core.types.resource.Video

internal fun inUpNextWindow(position: Long, duration: Long) =
    duration > 0 && position >= duration - minOf(120_000L, duration / 10)

// Core's next video, offered only for a series and never when it is announced but not out.
internal fun upNextVideo(type: String, playingId: String, next: Video?): Video? =
    next?.takeIf { type == "series" && it.id != playingId && !it.upcoming }
