@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Tracks
import androidx.media3.common.util.Util
import androidx.tv.material3.*
import java.util.Locale

/** One entry in the subtitle panel: nothing, a track in the media, or an add-on's file. */
internal sealed interface SubtitleChoice {
    data object Off : SubtitleChoice

    data class Track(val group: Tracks.Group, val index: Int) : SubtitleChoice {
        val format: Format
            get() = group.getTrackFormat(index)
    }

    data class Addon(val subtitle: AddonSubtitle) : SubtitleChoice
}

internal fun languageName(code: String?): String? {
    val normalized = code?.let(Util::normalizeLanguageCode)?.takeIf { it.isNotBlank() && it != "und" }
    return normalized?.let {
        Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH).takeIf(String::isNotBlank) ?: it
    }
}

/** The text tracks in the media, leaving out add-on files Kino has side-loaded into it. */
internal fun mediaTextTracks(tracks: Tracks): List<SubtitleChoice.Track> =
    tracks.groups
        .filter { it.type == C.TRACK_TYPE_TEXT }
        .flatMap { group ->
            (0 until group.length)
                .filter {
                    group.isTrackSupported(it) && sideLoadedTrackId(group.getTrackFormat(it)) == null
                }
                .map { SubtitleChoice.Track(group, it) }
        }

/**
 * The player's subtitle panel: which subtitles to show, including every file the add-ons offer,
 * and the timing, size and position to show them with. It opens on the current choice and closes
 * with Back.
 */
@Composable
internal fun SubtitlePanel(
    tracks: Tracks,
    addonSubtitles: List<AddonSubtitle>,
    selected: SubtitleChoice,
    delayMs: Long,
    size: Int,
    position: Int,
    loading: Boolean,
    failed: Boolean,
    onChoose: (SubtitleChoice) -> Unit,
    onDelay: (Long) -> Unit,
    onSize: (Int) -> Unit,
    onPosition: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val choices =
        listOf<SubtitleChoice>(SubtitleChoice.Off) +
            mediaTextTracks(tracks) +
            addonSubtitles
                .sortedBy { languageName(it.language) ?: it.language }
                .map { SubtitleChoice.Addon(it) }
    Dialog(onDismissRequest = onDismiss, properties = WideDialog) {
        Row(
            Modifier.width(820.dp)
                .heightIn(max = 520.dp)
                .background(SurfaceColor, RoundedCornerShape(12.dp))
                .padding(24.dp),
            horizontalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            LazyColumn(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    Text(
                        stringResource(R.string.subtitles),
                        Modifier.padding(bottom = 8.dp),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                items(choices) { choice ->
                    val focus = remember { FocusRequester() }
                    val current = choice == selected
                    Button(
                        { onChoose(choice) },
                        Modifier.fillMaxWidth().focusRequester(focus),
                        colors =
                            ButtonDefaults.colors(
                                containerColor =
                                    if (current) KinoColors.SurfaceActive else SurfaceColor
                            ),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(choiceTitle(choice), fontSize = 16.sp)
                                choiceDetail(choice)?.let {
                                    Text(it, fontSize = 13.sp, color = Muted)
                                }
                            }
                            if (current)
                                Icon(
                                    painterResource(R.drawable.ic_check),
                                    null,
                                    Modifier.size(18.dp),
                                )
                        }
                    }
                    LaunchedEffect(Unit) { if (current) focus.requestFocus() }
                }
                if (loading) item { Text(stringResource(R.string.loading), color = Muted) }
                if (failed)
                    item {
                        Text(stringResource(R.string.subtitle_fetch_failed), color = KinoColors.Danger)
                    }
            }
            Column(
                Modifier.width(300.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Setting(stringResource(R.string.subtitle_delay)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            { onDelay(delayMs - DELAY_STEP_MS) },
                            border = kinoOutlinedBorder(),
                        ) {
                            Text(stringResource(R.string.subtitle_earlier))
                        }
                        Text(
                            stringResource(
                                R.string.subtitle_delay_value,
                                "%+.2f".format(Locale.ROOT, delayMs / 1000.0),
                            ),
                            fontSize = 16.sp,
                        )
                        OutlinedButton(
                            { onDelay(delayMs + DELAY_STEP_MS) },
                            border = kinoOutlinedBorder(),
                        ) {
                            Text(stringResource(R.string.subtitle_later))
                        }
                    }
                }
                Setting(stringResource(R.string.subtitle_size)) {
                    Options(SubtitleAppearance.sizes, size, onSize) {
                        stringResource(R.string.subtitle_percent, it)
                    }
                }
                Setting(stringResource(R.string.subtitle_position)) {
                    Options(SubtitleAppearance.positions, position, onPosition) {
                        stringResource(
                            when (it) {
                                0 -> R.string.subtitle_position_default
                                SubtitleAppearance.positions[1] -> R.string.subtitle_position_higher
                                else -> R.string.subtitle_position_highest
                            }
                        )
                    }
                }
            }
        }
    }
}

private const val DELAY_STEP_MS = 250L

@Composable
private fun Setting(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 14.sp, color = Muted)
        content()
    }
}

@Composable
private fun Options(
    values: List<Int>,
    selected: Int,
    onSelect: (Int) -> Unit,
    label: @Composable (Int) -> String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        values.forEach { value ->
            Button(
                { onSelect(value) },
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                colors =
                    ButtonDefaults.colors(
                        containerColor =
                            if (value == selected) KinoColors.SurfaceActive else SurfaceColor
                    ),
            ) {
                Text(label(value), fontSize = 14.sp)
            }
        }
    }
}

@Composable
private fun choiceTitle(choice: SubtitleChoice): String =
    when (choice) {
        SubtitleChoice.Off -> stringResource(R.string.subtitle_off)
        is SubtitleChoice.Track ->
            languageName(choice.format.language)
                ?: choice.format.label
                ?: stringResource(R.string.subtitle_embedded)
        is SubtitleChoice.Addon ->
            languageName(choice.subtitle.language) ?: choice.subtitle.language
    }

@Composable
private fun choiceDetail(choice: SubtitleChoice): String? =
    when (choice) {
        SubtitleChoice.Off -> null
        is SubtitleChoice.Track ->
            listOfNotNull(
                    choice.format.label?.takeIf { languageName(choice.format.language) != null },
                    stringResource(R.string.subtitle_embedded),
                )
                .joinToString(" · ")
        is SubtitleChoice.Addon -> subtitleLabel(choice.subtitle)
    }
