package app.kino.tv

internal fun inUpNextWindow(position: Long, duration: Long) =
    duration > 0 && position >= duration - minOf(120_000L, duration / 10)
