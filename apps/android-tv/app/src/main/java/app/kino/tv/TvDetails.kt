@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.*
import com.stremio.core.types.resource.Video
import coil3.compose.AsyncImage

@Composable
internal fun DetailScreen(
    media: Media,
    videoId: String?,
    details: Details,
    error: Int?,
    resuming: Boolean,
    onBack: () -> Unit,
    onEpisode: (String) -> Unit,
    onRetry: () -> Unit,
    onLibrary: () -> Unit,
    onSource: (Source) -> Unit,
    onWatched: (Boolean) -> Unit = {},
    onEpisodeWatched: (Video, Boolean) -> Unit = { _, _ -> },
    onSeasonWatched: (Int, Boolean) -> Unit = { _, _ -> },
    failedSource: FailedSource? = null,
) {
    val meta = details.meta?.takeIf { it.id == media.id && it.type == media.type }
    val focus = remember { FocusRequester() }
    val episodeList = rememberLazyListState()
    var season by rememberSaveable { mutableStateOf<Int?>(null) }
    var lastEpisode by rememberSaveable { mutableStateOf(videoId) }
    var seasonMenu by remember { mutableStateOf(false) }
    val seasonFocus = remember { FocusRequester() }
    var pendingFocus by remember(videoId) { mutableStateOf(lastEpisode) }
    val videos = meta?.videos.orEmpty()
    LaunchedEffect(meta, videoId) {
        // Up Next returns to this saved entry with a new episode. Back must
        // restore that episode's season and focus, not the one playback left.
        if (videoId != null && videoId != lastEpisode) {
            videos
                .find { it.id == videoId }
                ?.let {
                    season = it.seasonNumber()
                    lastEpisode = videoId
                    pendingFocus = videoId
                    // The overview, library action, and season selector precede the episodes.
                    val headers =
                        3 + (if (details.loading) 1 else 0) + (if (details.failed) 1 else 0)
                    episodeList.requestScrollToItem(
                        headers +
                            seasonEpisodes(videos, it.seasonNumber()).indexOfFirst { episode ->
                                episode.id == videoId
                            }
                    )
                }
        } else if (meta != null && season == null) {
            season = videos.find { it.id == videoId }?.seasonNumber() ?: initialSeason(videos)
        }
    }
    if (media.type == "series" && videoId != null) {
        val episode = videos.find { it.id == videoId }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item {
                Button(onBack, Modifier.padding(horizontal = PageGutter).focusRequester(focus)) {
                    Icon(painterResource(R.drawable.ic_arrow_left), null, Modifier.size(18.dp))
                    Text(stringResource(R.string.back), Modifier.padding(start = 8.dp))
                }
                LaunchedEffect(resuming) { if (!resuming) focus.requestFocus() }
            }
            item {
                Column(
                    Modifier.padding(horizontal = PageGutter, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(meta?.name ?: media.title, color = Muted, fontSize = 16.sp)
                    Text(
                        episode?.title ?: stringResource(R.string.episode),
                        fontSize = 30.sp,
                        lineHeight = 36.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    episode?.seriesInfo?.let {
                        Text(
                            stringResource(
                                R.string.season_episode,
                                it.season.toInt(),
                                it.episode.toInt(),
                            ),
                            color = Muted,
                            fontSize = 16.sp,
                        )
                    }
                }
            }
            sourceItems(media, videoId, details, error, onRetry, onSource, failedSource)
        }
        return
    }
    if (seasonMenu) {
        Dialog(onDismissRequest = { seasonMenu = false }) {
            LazyColumn(
                Modifier.width(360.dp)
                    .heightIn(max = 420.dp)
                    .background(SurfaceColor, RoundedCornerShape(12.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(availableSeasons(videos)) { option ->
                    val optionFocus = remember { FocusRequester() }
                    Button(
                        {
                            season = option
                            lastEpisode = null
                            pendingFocus = null
                            seasonMenu = false
                        },
                        Modifier.fillMaxWidth().focusRequester(optionFocus),
                    ) {
                        Text(seasonLabel(option))
                    }
                    LaunchedEffect(Unit) { if (option == season) optionFocus.requestFocus() }
                }
            }
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        state = episodeList,
        contentPadding = PaddingValues(bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 270.dp)) {
                AsyncImage(
                    (meta?.background ?: media.background)?.takeIf(::secureUrl),
                    null,
                    Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop,
                )
                Box(
                    Modifier.matchParentSize()
                        .background(
                            Brush.horizontalGradient(
                                listOf(Background, Background.copy(alpha = .35f))
                            )
                        )
                )
                Box(
                    Modifier.matchParentSize()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Background)))
                )
                Button(
                    onBack,
                    Modifier.padding(start = PageGutter, top = 24.dp).focusRequester(focus),
                    shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                    colors = ButtonDefaults.colors(containerColor = Background.copy(alpha = .65f)),
                ) {
                    Icon(painterResource(R.drawable.ic_arrow_left), null, Modifier.size(18.dp))
                    Text(
                        stringResource(R.string.back),
                        Modifier.padding(start = 8.dp),
                        fontSize = 14.sp,
                    )
                }
                Column(
                    Modifier.align(Alignment.BottomStart)
                        .padding(start = PageGutter, end = PageGutter, top = 90.dp, bottom = 12.dp)
                ) {
                    val name = meta?.name ?: media.title
                    val logo = meta?.logo?.takeIf(::secureUrl)
                    var logoFailed by remember(logo) { mutableStateOf(false) }
                    // The title's logo art stands in for its name, which stays the
                    // spoken label; a logo that fails to load falls back to text.
                    if (logo != null && !logoFailed)
                        AsyncImage(
                            logo,
                            name,
                            Modifier.height(96.dp).widthIn(max = 460.dp),
                            alignment = Alignment.BottomStart,
                            contentScale = ContentScale.Fit,
                            onError = { logoFailed = true },
                        )
                    else
                        Text(
                            name,
                            fontSize = 36.sp,
                            lineHeight = 42.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-.8).sp,
                        )
                    val credits = meta?.credits()
                    Text(
                        listOfNotNull(
                                meta?.releaseInfo ?: media.year,
                                meta?.runtime,
                                stringResource(
                                    if (media.type == "movie") R.string.movie else R.string.series
                                ),
                                credits?.imdbRating?.let { stringResource(R.string.imdb_rating, it) },
                            )
                            .joinToString(" · "),
                        Modifier.padding(top = 10.dp),
                        fontSize = 15.sp,
                        color = Muted,
                    )
                    if (!credits?.genres.isNullOrEmpty())
                        Text(
                            credits!!.genres.joinToString(", "),
                            Modifier.padding(top = 4.dp),
                            fontSize = 14.sp,
                            color = KinoColors.TextFaint,
                        )
                    Spacer(Modifier.height(10.dp))
                    val description = meta?.description ?: media.description
                    if (!description.isNullOrBlank())
                        Text(
                            description,
                            Modifier.widthIn(max = 650.dp),
                            fontSize = 16.sp,
                            lineHeight = 22.sp,
                            color = Muted,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    meta?.credits()?.let { credits ->
                        CreditLine(stringResource(R.string.cast), credits.cast)
                        CreditLine(
                            stringResource(
                                if (credits.directors.size == 1) R.string.director
                                else R.string.directors
                            ),
                            credits.directors,
                        )
                    }
                }
            }
            LaunchedEffect(resuming) {
                if (!resuming && (media.type != "series" || lastEpisode == null))
                    focus.requestFocus()
            }
        }
        if (media.preview != null || meta != null)
            item {
                Row(
                    Modifier.padding(horizontal = PageGutter),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    OutlinedButton(
                        onLibrary,
                        shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                        border = kinoOutlinedBorder(),
                    ) {
                        Icon(
                            painterResource(
                                if (meta?.inLibrary == true) R.drawable.ic_check
                                else R.drawable.ic_plus
                            ),
                            null,
                            Modifier.size(18.dp),
                        )
                        Text(
                            stringResource(
                                if (meta?.inLibrary == true) R.string.remove_library
                                else R.string.add_library
                            ),
                            Modifier.padding(start = 10.dp),
                            fontSize = 15.sp,
                        )
                    }
                    // Core marks a title through its details model, so this waits for the metadata.
                    if (media.type == "movie" && meta != null)
                        OutlinedButton(
                            { onWatched(!meta.watched) },
                            shape = ButtonDefaults.shape(RoundedCornerShape(8.dp)),
                            border = kinoOutlinedBorder(),
                        ) {
                            Icon(
                                painterResource(R.drawable.ic_circle_check),
                                null,
                                Modifier.size(18.dp),
                                tint = if (meta.watched) LocalContentColor.current else Muted,
                            )
                            Text(
                                stringResource(
                                    if (meta.watched) R.string.mark_unwatched
                                    else R.string.mark_watched
                                ),
                                Modifier.padding(start = 10.dp),
                                fontSize = 15.sp,
                            )
                        }
                }
            }
        if (details.loading) item { StatusText(R.string.loading) }
        if (details.failed) item { RetryRow(onRetry) }
        if (media.type == "series" && meta != null) {
            val shownSeason = season ?: initialSeason(videos)
            val episodes = seasonEpisodes(videos, shownSeason)
            // A season without any artwork keeps the compact row.
            val thumbnails = episodes.any { secureUrl(it.thumbnail) }
            val seasonWatched = episodes.isNotEmpty() && episodes.all { it.watched }
            item {
                Row(
                    Modifier.padding(horizontal = PageGutter),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    OutlinedButton(
                        { seasonMenu = true },
                        Modifier.focusRequester(seasonFocus),
                        border = kinoOutlinedBorder(),
                    ) {
                        Text(seasonLabel(shownSeason))
                        Icon(
                            painterResource(R.drawable.ic_chevron_down),
                            null,
                            Modifier.padding(start = 12.dp).size(18.dp),
                        )
                    }
                    // Core marks seasons by number; unnumbered episodes are marked one at a time.
                    if (shownSeason >= 0)
                        OutlinedButton(
                            { onSeasonWatched(shownSeason, !seasonWatched) },
                            border = kinoOutlinedBorder(),
                        ) {
                            Icon(
                                painterResource(R.drawable.ic_circle_check),
                                null,
                                Modifier.size(18.dp),
                                tint = if (seasonWatched) LocalContentColor.current else Muted,
                            )
                            Text(
                                stringResource(
                                    if (seasonWatched) R.string.mark_season_unwatched
                                    else R.string.mark_season_watched
                                ),
                                Modifier.padding(start = 10.dp),
                            )
                        }
                }
            }
            items(episodes, key = { it.id }) { episode ->
                // Up from the first episode is the way back to the season choice, not to
                // the season's watched action beside it.
                val first = episode.id == episodes.firstOrNull()?.id
                val episodeFocus = remember { FocusRequester() }
                Row(
                    Modifier.padding(horizontal = PageGutter)
                        .fillMaxWidth()
                        .height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Surface(
                        onClick = {
                            lastEpisode = episode.id
                            onEpisode(episode.id)
                        },
                        modifier =
                            Modifier.weight(1f).focusRequester(episodeFocus).focusProperties {
                                if (first) up = seasonFocus
                            },
                        shape = ClickableSurfaceDefaults.shape(RowShape),
                        colors = rowColors(),
                        border = rowBorder(),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
                    ) {
                        Row(
                            Modifier.padding(18.dp),
                            horizontalArrangement = Arrangement.spacedBy(20.dp),
                        ) {
                            episode.seriesInfo?.let {
                                Text(
                                    it.episode.toString(),
                                    Modifier.width(36.dp),
                                    color = Muted,
                                    fontSize = 18.sp,
                                )
                            }
                            if (thumbnails)
                                Box(
                                    Modifier.width(160.dp)
                                        .aspectRatio(16f / 9f)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(SurfaceColor)
                                ) {
                                    AsyncImage(
                                        episode.thumbnail?.takeIf(::secureUrl),
                                        null,
                                        Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop,
                                    )
                                }
                            Column(
                                Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(episode.title, fontSize = 18.sp, lineHeight = 24.sp)
                                val status =
                                    when {
                                        episode.upcoming -> stringResource(R.string.upcoming)
                                        episode.watched -> stringResource(R.string.watched)
                                        (episode.progress ?: 0.0) > 0 ->
                                            stringResource(R.string.in_progress)
                                        else -> null
                                    }
                                val line = listOfNotNull(status, episode.airDate())
                                if (line.isNotEmpty())
                                    Text(
                                        line.joinToString(" · "),
                                        color = if (episode.upcoming) KinoColors.TextStrong else Muted,
                                        fontSize = 13.sp,
                                    )
                            }
                        }
                    }
                    val watchedLabel =
                        stringResource(
                            if (episode.watched) R.string.mark_episode_unwatched
                            else R.string.mark_episode_watched,
                            episode.title,
                        )
                    Surface(
                        onClick = { onEpisodeWatched(episode, !episode.watched) },
                        modifier = Modifier.fillMaxHeight().width(72.dp),
                        shape = ClickableSurfaceDefaults.shape(RowShape),
                        colors = rowColors(),
                        border = rowBorder(),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
                    ) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Icon(
                                painterResource(R.drawable.ic_circle_check),
                                watchedLabel,
                                Modifier.size(22.dp),
                                tint = if (episode.watched) LocalContentColor.current else Muted,
                            )
                        }
                    }
                }
                LaunchedEffect(resuming, pendingFocus) {
                    if (!resuming && pendingFocus == episode.id) {
                        episodeFocus.requestFocus()
                        pendingFocus = null
                    }
                }
            }
        }
        if (media.type == "movie" && videoId != null)
            sourceItems(media, videoId, details, error, onRetry, onSource, failedSource)
    }
}

@Composable
private fun CreditLine(label: String, names: List<String>) {
    if (names.isEmpty()) return
    Row(Modifier.padding(top = 6.dp).widthIn(max = 650.dp)) {
        Text(label, Modifier.width(96.dp), fontSize = 14.sp, color = KinoColors.TextFaint)
        // Six names fill the line on a 1080p screen without wrapping.
        Text(
            names.take(6).joinToString(", "),
            fontSize = 14.sp,
            color = Muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun seasonLabel(season: Int) =
    when (season) {
        -1 -> stringResource(R.string.other_episodes)
        0 -> stringResource(R.string.specials)
        else -> stringResource(R.string.season, season)
    }

private fun LazyListScope.sourceItems(
    media: Media,
    videoId: String,
    details: Details,
    error: Int?,
    onRetry: () -> Unit,
    onSource: (Source) -> Unit,
    failed: FailedSource? = null,
) {
    val sources =
        details.sources.filter {
            it.request.path.type == media.type &&
                it.request.path.id == videoId &&
                details.meta?.id == media.id &&
                details.meta.type == media.type
        }
    item {
        Text(
            stringResource(R.string.sources),
            Modifier.padding(start = PageGutter),
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
    error?.let {
        item {
            Text(
                stringResource(it),
                Modifier.padding(horizontal = PageGutter),
                color = KinoColors.Danger,
            )
        }
    }
    if (details.loading || details.sourcesLoading) item { StatusText(R.string.loading) }
    if (details.failed || details.sourceErrors.isNotEmpty()) item { RetryRow(onRetry) }
    if (!details.loading && !details.sourcesLoading && sources.isEmpty())
        item { StatusText(R.string.empty_sources) }
    items(sources) { source ->
        SourceRow(
            source,
            details.meta?.runtime,
            failed = failed?.videoId == videoId && failed.stream == source.stream.source,
            onSelect = { onSource(source) },
        )
    }
}

/**
 * A plain loading screen between Home and the player while Core confirms the remembered source. The
 * poster the user just chose says what is loading, so it carries no text. It covers the rail as
 * well as the details page, holds focus, and swallows every key but Back, so nothing beneath can be
 * activated a moment before playback takes over; Back reveals the details page for a manual choice.
 * The caller drops it from composition when the player mounts, so its focus never competes with the
 * surface.
 */
@Composable
internal fun ResumeOverlay(visible: Boolean, onCancel: () -> Unit) {
    val focus = remember { FocusRequester() }
    BackHandler(visible, onCancel)
    // No entrance fade: the page must never show through before the spinner.
    AnimatedVisibility(visible, enter = EnterTransition.None, exit = fadeOut(tween(250))) {
        Box(
            Modifier.fillMaxSize()
                .background(Background)
                .focusRequester(focus)
                .focusable()
                .onPreviewKeyEvent { it.key != Key.Back },
            contentAlignment = Alignment.Center,
        ) {
            Spinner()
        }
        LaunchedEffect(Unit) { focus.requestFocus() }
    }
}

@Composable
private fun Spinner() {
    val angle by
        rememberInfiniteTransition(label = "spinner")
            .animateFloat(
                0f,
                360f,
                infiniteRepeatable(tween(1000, easing = LinearEasing)),
                label = "angle",
            )
    val track = KinoColors.TextStrong.copy(alpha = .16f)
    Canvas(Modifier.size(30.dp)) {
        val stroke = Stroke(3.dp.toPx(), cap = StrokeCap.Round)
        val inset = stroke.width / 2
        val bounds = Size(size.width - stroke.width, size.height - stroke.width)
        drawArc(track, 0f, 360f, false, Offset(inset, inset), bounds, style = stroke)
        drawArc(
            KinoColors.TextStrong,
            angle,
            80f,
            false,
            Offset(inset, inset),
            bounds,
            style = stroke,
        )
    }
}
