package app.kino.tv

import com.stremio.core.types.resource.MetaItem
import com.stremio.core.types.resource.Video
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Names an add-on attaches to a title as categorized links, as Cinemeta sends them. */
internal data class Credits(
    val genres: List<String>,
    val cast: List<String>,
    val directors: List<String>,
    /** The add-on's IMDb rating as written, such as "8.2". */
    val imdbRating: String?,
)

private val rating = Regex("""\d{1,2}(\.\d{1,2})?""")

internal fun MetaItem.credits(): Credits {
    fun names(category: String) =
        links.filter { it.category == category }.map { it.name.trim() }.filter { it.isNotEmpty() }
            .distinct()
    return Credits(
        genres = names("Genres"),
        cast = names("Cast"),
        directors = names("Directors"),
        imdbRating =
            links.firstOrNull { it.category == "imdb" }?.name?.trim()?.takeIf(rating::matches),
    )
}

// Air dates are calendar days; formatting them in UTC keeps a midnight release
// from showing as the day before west of Greenwich.
private val airDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneOffset.UTC)

internal fun Video.airDate(): String? =
    released?.let { airDate.format(Instant.ofEpochSecond(it.seconds, it.nanos.toLong())) }
