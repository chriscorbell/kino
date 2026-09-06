package app.kino.tv

import com.stremio.core.types.resource.Video

// The separate unknown-season entry sorts after numbered seasons and Specials.
internal fun Video.seasonNumber() = seriesInfo?.season?.toInt() ?: -1

internal fun availableSeasons(videos: List<Video>) =
    videos.map { it.seasonNumber() }.distinct().sortedBy { if (it < 0) Int.MAX_VALUE else it }

internal fun seasonEpisodes(videos: List<Video>, season: Int) =
    videos
        .filter { it.seasonNumber() == season }
        .sortedWith(
            compareBy<Video> { it.seriesInfo?.episode?.toInt() ?: Int.MAX_VALUE }.thenBy { it.id }
        )

internal fun initialSeason(videos: List<Video>): Int {
    val seasons = availableSeasons(videos)
    val regular = seasons.filter { it > 0 }
    val fallback = if (1 in regular) 1 else regular.firstOrNull() ?: seasons.firstOrNull() ?: -1
    val previous = videos.find { it.currentVideo } ?: return fallback
    if (!previous.watched && (previous.progress ?: 0.0) <= 0) return fallback
    val season = previous.seasonNumber()
    if (season <= 0 || !previous.watched) return season
    // Announced, unreleased episodes still count when identifying the finale.
    val episodes = seasonEpisodes(videos, season)
    val finale = episodes.all { it.seriesInfo != null } && episodes.lastOrNull()?.id == previous.id
    return if (finale) regular.firstOrNull { it > season } ?: season else season
}
