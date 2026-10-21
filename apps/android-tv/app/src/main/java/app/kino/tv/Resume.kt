package app.kino.tv

// The saved offset, only when Core saved it for the video being played.
internal fun resumeOffset(savedVideoId: String?, timeOffset: Long?, playingId: String): Long =
    if (savedVideoId == playingId) timeOffset ?: 0L else 0L
