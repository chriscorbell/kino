@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*
import coil3.compose.AsyncImage
import kotlin.math.roundToInt

internal class PosterFocusRegistry {
    val requesters = mutableMapOf<String, FocusRequester>()
    var lastFocusedKey: String? = null
}

internal val LocalPosterFocus = staticCompositionLocalOf { PosterFocusRegistry() }

@Composable
internal fun PosterCard(
    media: Media,
    resume: Boolean,
    focusKey: String,
    firstInRow: Boolean,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    val registry = LocalPosterFocus.current
    val removeLabel = stringResource(R.string.continue_remove)
    val navigation = LocalNavigationFocus.current
    val focus = remember(focusKey) { FocusRequester() }
    val caption =
        media.year?.take(4)?.takeIf { it.all(Char::isDigit) }
            ?: stringResource(if (media.type == "movie") R.string.movie else R.string.series)
    // The card announces both lines. Its sibling captions must not repeat them as separate stops.
    val episode =
        if (resume && media.type == "series") episodeFromVideoId(media.id, media.videoId) else null
    val episodeShort =
        episode?.let { (season, number) ->
            if (season == 0) stringResource(R.string.special_number, number)
            else stringResource(R.string.episode_short, season, number)
        }
    val episodeLong =
        episode?.let { (season, number) ->
            if (season == 0) stringResource(R.string.special_number, number)
            else stringResource(R.string.season_episode, season, number)
        }
    // Library cards carry Core's state: partial progress, and a badge for new episodes or a title
    // marked watched. Continue Watching draws its own progress with the resume affordance.
    val partial = !resume && (media.progress ?: 0.0).let { it > 0.0 && it < 1.0 }
    val badge =
        when {
            resume -> null
            media.newVideos > 0 -> stringResource(R.string.new_episodes_badge, media.newVideos)
            media.watched -> stringResource(R.string.watched_badge)
            else -> null
        }
    val badgeLabel =
        when {
            resume -> null
            media.newVideos > 0 ->
                pluralStringResource(R.plurals.new_episodes, media.newVideos, media.newVideos)
            media.watched -> stringResource(R.string.watched_badge)
            else -> null
        }
    val accessibilityLabel =
        if (resume)
            listOfNotNull(stringResource(R.string.resume_title, media.title), episodeLong)
                .joinToString(", ")
        else
            listOfNotNull(
                    media.title,
                    caption,
                    badgeLabel,
                    if (partial)
                        stringResource(
                            R.string.progress_watched,
                            ((media.progress ?: 0.0) * 100).roundToInt().coerceIn(1, 99),
                        )
                    else null,
                )
                .joinToString(", ")
    var artworkFailed by remember(media.poster) { mutableStateOf(false) }
    DisposableEffect(focusKey) {
        registry.requesters[focusKey] = focus
        onDispose { registry.requesters.remove(focusKey) }
    }
    Column(Modifier.width(PosterWidth), horizontalAlignment = Alignment.CenterHorizontally) {
        Card(
            onClick,
            Modifier.width(PosterWidth)
                .height(PosterHeight)
                .quickFocusScale()
                .focusRequester(focus)
                .focusProperties { if (firstInRow) left = navigation }
                .onFocusChanged { if (it.isFocused) registry.lastFocusedKey = focusKey }
                .semantics {
                    contentDescription = accessibilityLabel
                    // A held select opens the options; screen readers reach them as an action.
                    if (onLongClick != null)
                        customActions =
                            listOf(CustomAccessibilityAction(removeLabel) { onLongClick(); true })
                },
            onLongClick = onLongClick,
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            border =
                CardDefaults.border(
                    focusedBorder =
                        Border(
                            androidx.compose.foundation.BorderStroke(2.dp, KinoColors.TextStrong),
                            shape = RoundedCornerShape(10.dp),
                        )
                ),
            scale = CardDefaults.scale(focusedScale = 1f, pressedScale = 1f),
        ) {
            Box(Modifier.fillMaxSize().background(SurfaceColor)) {
                if (media.poster == null || artworkFailed)
                    Text(
                        media.title.take(1),
                        Modifier.align(Alignment.Center).clearAndSetSemantics {},
                        fontSize = 42.sp,
                        color = KinoColors.TextFaint,
                    )
                AsyncImage(
                    media.poster?.takeIf(::secureUrl),
                    null,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    onError = { artworkFailed = true },
                )
                badge?.let {
                    Text(
                        it.uppercase(),
                        Modifier.align(Alignment.TopEnd)
                            .padding(8.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.Black.copy(alpha = .76f))
                            .border(1.dp, Color.White.copy(alpha = .14f), RoundedCornerShape(50))
                            .padding(horizontal = 7.dp, vertical = 3.dp)
                            .clearAndSetSemantics {},
                        fontSize = 10.sp,
                        lineHeight = 12.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = .5.sp,
                        color = KinoColors.Text,
                    )
                }
                if (partial) ProgressTrack(media.progress ?: 0.0, Modifier.align(Alignment.BottomStart))
                if (resume) {
                    Box(
                        Modifier.align(Alignment.Center)
                            .size(36.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.Black.copy(alpha = .55f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(painterResource(R.drawable.play), null, Modifier.size(24.dp))
                    }
                    ProgressTrack(media.progress ?: 0.0, Modifier.align(Alignment.BottomStart))
                }
            }
        }
        Text(
            media.title,
            Modifier.padding(top = 10.dp).fillMaxWidth().clearAndSetSemantics {},
            fontSize = 14.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        if (!resume || episodeShort != null)
            Text(
                if (resume) episodeShort!! else caption,
                Modifier.padding(top = 3.dp).clearAndSetSemantics {},
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = KinoColors.TextFaint,
            )
    }
}

@Composable
private fun ProgressTrack(progress: Double, modifier: Modifier) {
    Box(modifier.fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = .2f))) {
        Box(
            Modifier.fillMaxWidth(progress.toFloat().coerceIn(0f, 1f))
                .fillMaxHeight()
                .background(KinoColors.TextStrong)
        )
    }
}
