@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.*

/**
 * One source as a structured row: the same fields, in the same order, as the desktop client, with
 * the spacing a remote needs. Selecting the row plays. The Details control beside it opens the
 * complete add-on text and the rarer fields in place, and never starts playback.
 */
@Composable
internal fun SourceRow(
    source: Source,
    runtime: String?,
    failed: Boolean = false,
    onSelect: () -> Unit,
) {
    val unnamed = stringResource(R.string.source_unnamed)
    val fields = remember(source) { sourceFields(source.stream, unnamed) }
    var expanded by remember(source) { mutableStateOf(false) }
    val lead = listOfNotNull(fields.resolution, fields.releaseType).joinToString(" ")
    val traits =
        listOfNotNull(fields.videoRange, fields.videoCodec, fields.audio) +
            fields.languages +
            listOfNotNull(fields.releaseGroup)
    val size = sizeLabel(fields.size)
    val bitrate = bitrateLabel(fields, runtime)
    Column(Modifier.padding(horizontal = PageGutter)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(
                onClick = { if (source.playable) onSelect() },
                modifier = Modifier.weight(1f),
                shape = ClickableSurfaceDefaults.shape(RowShape),
                colors = rowColors(),
                border = rowBorder(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
            ) {
                Row(
                    Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (fields.structured) {
                            Text(
                                lead.ifEmpty { fields.fallbackTitle },
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 18.sp,
                            )
                            if (traits.isNotEmpty())
                                Text(traits.joinToString("   "), fontSize = 15.sp, color = Muted)
                        } else {
                            Text(
                                fields.fallbackTitle,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 18.sp,
                            )
                        }
                        Text(source.provider, fontSize = 13.sp, color = KinoColors.TextFaint)
                        if (!source.playable)
                            Text(
                                stringResource(
                                    R.string.source_unsupported
                                ),
                                fontSize = 13.sp,
                                color = Muted,
                            )
                        // The source that just failed stays marked, so the next choice is another.
                        if (failed)
                            Text(
                                stringResource(R.string.source_failed),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = KinoColors.Danger,
                            )
                    }
                    // Figures sit in their own column so rows line up for comparison.
                    Column(horizontalAlignment = Alignment.End) {
                        size?.let { Text(it, fontSize = 16.sp) }
                        bitrate?.let { Text(it, fontSize = 13.sp, color = Muted) }
                    }
                }
            }
            Surface(
                onClick = { expanded = !expanded },
                shape = ClickableSurfaceDefaults.shape(RowShape),
                colors = rowColors(),
                border = rowBorder(),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
            ) {
                // A fixed width keeps the figures column still when the label changes.
                Text(
                    stringResource(
                        if (expanded) R.string.source_hide_details else R.string.source_details
                    ),
                    Modifier.width(132.dp).padding(horizontal = 12.dp, vertical = 16.dp),
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
        if (expanded) {
            Column(
                Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                fields.original.filename?.let { DetailField(R.string.source_filename, it) }
                fields.original.description?.let { DetailField(R.string.source_addon_text, it) }
                DetailField(R.string.source_addon, source.provider)
                fields.releaseGroup?.let { DetailField(R.string.source_release_group, it) }
                if (fields.languages.isNotEmpty())
                    DetailField(R.string.source_languages, fields.languages.joinToString(", "))
                size?.let { DetailField(R.string.source_size, it) }
                bitrate?.let {
                    DetailField(
                        R.string.source_bitrate,
                        if (fields.statedMegabits == null)
                            "$it  " + stringResource(R.string.source_bitrate_estimated)
                        else it,
                    )
                }
                fields.peers?.let { DetailField(R.string.source_peers, it.toString()) }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(KinoColors.BorderSubtle))
    }
}

@Composable
private fun DetailField(label: Int, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(stringResource(label), fontSize = 12.sp, color = KinoColors.TextFaint)
        Text(value, fontSize = 15.sp, color = Muted)
    }
}

@Composable
private fun sizeLabel(size: SourceSize?): String? =
    when (size) {
        null -> null
        is SourceSize.Text -> size.text
        is SourceSize.Bytes -> {
            val gibibytes = size.bytes / (1L shl 30).toDouble()
            // One decimal at every size, so "54.3 GB" and "6.9 GB" line up.
            if (gibibytes >= 1) stringResource(R.string.format_gigabytes, "%.1f".format(gibibytes))
            else stringResource(R.string.format_megabytes, (size.bytes / (1L shl 20)).toInt())
        }
    }

@Composable
private fun bitrateLabel(fields: SourceFields, runtime: String?): String? {
    fun digits(value: Double) = if (value >= 10) "%.0f".format(value) else "%.1f".format(value)
    fields.statedMegabits?.let {
        return stringResource(R.string.format_megabits, digits(it))
    }
    val estimate = estimatedMegabits(fields.size, runtimeMinutes(runtime)) ?: return null
    return stringResource(R.string.format_estimated_megabits, digits(estimate))
}
