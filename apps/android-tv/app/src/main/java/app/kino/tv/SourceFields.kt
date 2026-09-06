package app.kino.tv

import com.stremio.core.types.resource.Stream

/**
 * What a source row shows, in the same shape as the desktop client's
 * `sourceFields.ts`. Every field is null when nothing reliable says otherwise:
 * a missing range is not SDR, and a size the add-on wrote with a slash is not
 * split into two numbers. Structured hints win over text, and whatever text is
 * not recognised stays in [Original.remainder] for the details view.
 */
data class SourceFields(
    val resolution: String?,
    val releaseType: String?,
    val releaseGroup: String?,
    val languages: List<String>,
    val audio: String?,
    val videoCodec: String?,
    val videoRange: String?,
    val size: SourceSize?,
    /** A rate the add-on states itself, in Mbps. */
    val statedMegabits: Double?,
    val peers: Int?,
    /** The primary text when nothing structured could be read. */
    val fallbackTitle: String,
    val original: Original,
) {
    data class Original(
        val name: String?,
        val description: String?,
        val filename: String?,
        val remainder: List<String>,
    )

    val structured: Boolean
        get() =
            resolution != null ||
                releaseType != null ||
                videoCodec != null ||
                audio != null ||
                videoRange != null ||
                languages.isNotEmpty()
}

sealed interface SourceSize {
    /** From the add-on's structured hint, or an unambiguous "12.3 GB" in its text. */
    data class Bytes(val bytes: Long) : SourceSize

    /** Text such as "6.8 / 13.6 GB", shown as written rather than interpreted. */
    data class Text(val text: String) : SourceSize
}

private val ci = RegexOption.IGNORE_CASE
private val resolutionPattern = Regex("\\b(2160p|1440p|1080p|720p|576p|480p)\\b|\\b(4k|uhd)\\b", ci)
private val releaseTypes =
    listOf(
        Regex("\\b(?:bd|blu-?ray\\W?)?remux\\b", ci) to "Remux",
        Regex("\\bweb-?dl\\b", ci) to "WEB-DL",
        Regex("\\bweb-?rip\\b", ci) to "WEBRip",
        Regex("\\b(?:hd|pd)tv(?:rip)?\\b", ci) to "HDTV",
        Regex("\\b(?:uhd|bd|br)rip\\b", ci) to "BDRip",
        Regex("\\bblu-?ray\\b", ci) to "BluRay",
        Regex("\\bdvd(?:rip)?\\b", ci) to "DVD",
        Regex("\\b(?:hd)?cam(?:rip)?\\b|\\bts(?:rip)?\\b|\\btelesync\\b", ci) to "CAM",
        Regex("\\bweb\\b", ci) to "WEB",
    )
private val videoCodecs =
    listOf(
        Regex("\\b(?:x|h\\.?)?265\\b|\\bhevc\\b", ci) to "HEVC",
        Regex("\\b(?:x|h\\.?)?264\\b|\\bavc\\b", ci) to "H.264",
        Regex("\\bav1\\b", ci) to "AV1",
        Regex("\\bvp9\\b", ci) to "VP9",
        Regex("\\bxvid\\b|\\bdivx\\b", ci) to "XviD",
    )
// Ordered so a fuller name wins over its prefix, e.g. DTS-HD MA before DTS.
private val audioCodecs =
    listOf(
        Regex("\\btruehd\\b", ci) to "TrueHD",
        Regex("\\bdts-?(?:hd\\W?ma|dh\\W?ma|hd)\\b", ci) to "DTS-HD MA",
        Regex("\\bdts(?:-?x)\\b", ci) to "DTS:X",
        Regex("\\bdts(?![a-z])", ci) to "DTS",
        Regex("\\b(?:ddp|dd\\+|e-?ac-?3|eac3)(?![a-z])", ci) to "DDP",
        Regex("\\b(?:dd|ac-?3|dolby\\W?digital)(?![a-z])", ci) to "AC3",
        Regex("\\baac(?![a-z])", ci) to "AAC",
        Regex("\\bopus(?![a-z])", ci) to "Opus",
        Regex("\\bflac\\b", ci) to "FLAC",
        Regex("\\b(?:lpcm|pcm)\\b", ci) to "PCM",
        Regex("\\bmp3\\b", ci) to "MP3",
    )
private val channelsPattern = Regex("(?<!\\d)([1-9])[.,]([0-2])(?!\\d)")
private val atmosPattern = Regex("\\batmos\\b", ci)
private val sizePattern = Regex("(\\d+(?:[.,]\\d+)?)\\s*(TB|GB|MB|GiB|MiB|TiB)\\b", ci)
private val slashSizePattern =
    Regex("\\d+(?:[.,]\\d+)?\\s*(?:[A-Z]i?B\\s*)?/\\s*\\d+(?:[.,]\\d+)?\\s*[A-Z]i?B\\b", ci)
private val bitratePattern = Regex("(\\d+(?:[.,]\\d+)?)\\s*(?:mbps|mb/s|mbit/?s)\\b", ci)
private val peersPattern = Regex("👤\\s*(\\d+)")
// Add-on marker lines: peers, size, tracker, or a row of flags.
private val markerLine = Regex("👤|💾|⚙")
private val flagPattern = Regex("[\\x{1F1E6}-\\x{1F1FF}]{2}")
private val flagsOnlyLine = Regex("^(?:[\\x{1F1E6}-\\x{1F1FF}]{2}|[\\s/|])+$")
private val groupBracket = Regex("\\[([A-Za-z0-9.]{2,20})](?:\\.[a-z0-9]{2,4})?\\s*$")
private val groupTrailing = Regex("-([A-Za-z0-9]{2,20})(?:\\.[a-z0-9]{2,4})?\\s*$")
private val notAGroup = Regex("^(?:x26[45]|h26[45]|hevc|aac|ac3|dts|ddp|dl|rip)$", ci)
private val languageToken = Regex("\\b[A-Z]{3}\\b")

// Flags name a region; the row names a language.
private val regionLanguages =
    mapOf(
        "GB" to "EN", "US" to "EN", "AU" to "EN", "CA" to "EN",
        "IT" to "IT", "FR" to "FR", "DE" to "DE", "ES" to "ES", "MX" to "ES",
        "PT" to "PT", "BR" to "PT", "RU" to "RU", "UA" to "UK", "PL" to "PL",
        "HU" to "HU", "CZ" to "CS", "SK" to "SK", "NL" to "NL", "SE" to "SV",
        "NO" to "NO", "DK" to "DA", "FI" to "FI", "JP" to "JA", "CN" to "ZH",
        "TW" to "ZH", "KR" to "KO", "IN" to "HI", "TR" to "TR", "GR" to "EL",
        "RO" to "RO", "BG" to "BG", "HR" to "HR", "RS" to "SR", "IL" to "HE",
        "SA" to "AR", "AE" to "AR", "TH" to "TH", "VN" to "VI", "ID" to "ID",
    )
// Three-letter tokens release names use, only as whole words.
private val languageTokens =
    mapOf(
        "ENG" to "EN", "ITA" to "IT", "FRE" to "FR", "FRA" to "FR", "GER" to "DE",
        "DEU" to "DE", "SPA" to "ES", "ESP" to "ES", "POR" to "PT", "RUS" to "RU",
        "UKR" to "UK", "POL" to "PL", "HUN" to "HU", "CZE" to "CS", "NLD" to "NL",
        "DUT" to "NL", "SWE" to "SV", "NOR" to "NO", "DAN" to "DA", "FIN" to "FI",
        "JPN" to "JA", "CHI" to "ZH", "KOR" to "KO", "HIN" to "HI", "TUR" to "TR",
        "GRE" to "EL",
    )

private fun flagToRegion(flag: String): String {
    val builder = StringBuilder()
    var index = 0
    while (index < flag.length) {
        val point = flag.codePointAt(index)
        builder.append((point - 0x1F1E6 + 'A'.code).toChar())
        index += Character.charCount(point)
    }
    return builder.toString()
}

private fun parseSizeBytes(amount: String, unit: String): Long? {
    val value = amount.replace(',', '.').toDoubleOrNull() ?: return null
    if (value <= 0) return null
    val scale =
        when (unit.first().lowercaseChar()) {
            't' -> 1L shl 40
            'g' -> 1L shl 30
            else -> 1L shl 20
        }
    return Math.round(value * scale)
}

/** "2h 22min", "142 min", and "142" all mean minutes; anything else is unknown. */
fun runtimeMinutes(runtime: String?): Int? {
    if (runtime.isNullOrBlank()) return null
    val hours = Regex("(\\d+)\\s*h", ci).find(runtime)?.groupValues?.get(1)?.toIntOrNull()
    val minutes = Regex("(\\d+)\\s*m", ci).find(runtime)?.groupValues?.get(1)?.toIntOrNull()
    if (hours != null || minutes != null) {
        return ((hours ?: 0) * 60 + (minutes ?: 0)).takeIf { it > 0 }
    }
    return runtime.trim().toIntOrNull()?.takeIf { it > 0 }
}

/** Mbps from a byte size and a runtime, or null when either is unknown. */
fun estimatedMegabits(size: SourceSize?, runtimeMinutes: Int?): Double? {
    val bytes = (size as? SourceSize.Bytes)?.bytes ?: return null
    val minutes = runtimeMinutes ?: return null
    val megabits = bytes * 8.0 / (minutes * 60.0) / 1_000_000.0
    return megabits.takeIf { it.isFinite() && it >= 0.1 }
}

private fun detectRange(text: String): String? {
    val parts = mutableListOf<String>()
    if (Regex("\\b(?:dv|dovi|dolby\\W?vision)\\b", ci).containsMatchIn(text)) parts += "DV"
    when {
        Regex("\\bhdr10\\+", ci).containsMatchIn(text) -> parts += "HDR10+"
        Regex("\\bhdr10\\b", ci).containsMatchIn(text) -> parts += "HDR10"
        Regex("\\bhdr\\b", ci).containsMatchIn(text) -> parts += "HDR"
    }
    if (Regex("\\bhlg\\b", ci).containsMatchIn(text)) parts += "HLG"
    if (parts.isNotEmpty()) return parts.joinToString(" + ")
    // Only an explicit claim counts. Absence of HDR tokens says nothing.
    return if (Regex("\\bsdr\\b", ci).containsMatchIn(text)) "SDR" else null
}

private fun detectAudio(text: String): String? {
    val codec = audioCodecs.firstOrNull { (pattern, _) -> pattern.containsMatchIn(text) }?.second
    val atmos = if (atmosPattern.containsMatchIn(text)) "Atmos" else null
    val channels = channelsPattern.find(text)?.let { "${it.groupValues[1]}.${it.groupValues[2]}" }
    return listOfNotNull(codec, atmos, channels).joinToString(" ").ifEmpty { null }
}

private fun detectGroup(text: String): String? {
    // A trailing "-GROUP" on a release name, before any extension, or a
    // bracketed tag at the end such as "[QxR]". Scene names put the year and
    // resolution before the group, which keeps a hyphenated title from matching.
    groupBracket.find(text)?.let {
        return it.groupValues[1]
    }
    val group = groupTrailing.find(text)?.groupValues?.get(1) ?: return null
    // Channel layouts and codecs end release names too; those are not groups.
    if (group.all { it.isDigit() } || notAGroup.matches(group)) return null
    return group
}

private fun detectLanguages(text: String): List<String> {
    val found = mutableListOf<String>()
    fun push(code: String) {
        if (code !in found) found += code
    }
    for (flag in flagPattern.findAll(text)) {
        val region = flagToRegion(flag.value)
        push(regionLanguages[region] ?: region)
    }
    if (found.isEmpty()) {
        for (token in languageToken.findAll(text)) languageTokens[token.value]?.let(::push)
        if (found.isEmpty() && Regex("\\bmulti\\b", ci).containsMatchIn(text)) push("MULTI")
    }
    return found
}

/** The line that reads like a release name: the longest one without an add-on marker. */
private fun releaseLine(lines: List<String>): String? =
    lines
        .filter { !markerLine.containsMatchIn(it) && !flagsOnlyLine.matches(it) }
        .maxByOrNull { it.length }

private fun splitLines(value: String?): List<String> =
    value.orEmpty().split('\n').map { it.replace(Regex("\\s+"), " ").trim() }.filter {
        it.isNotEmpty()
    }

fun sourceFields(stream: Stream, unnamed: String): SourceFields {
    val name = stream.name?.trim()?.ifEmpty { null }
    val description = stream.description?.trim()?.ifEmpty { null }
    val filename = stream.behaviorHints.filename?.trim()?.ifEmpty { null }
    val nameLines = splitLines(name)
    val descriptionLines = splitLines(description)
    val lines = nameLines + descriptionLines
    // The add-on's release line is consumed even when a filename hint replaces
    // it as the primary spelling; it is the same release, not leftover text.
    val described = releaseLine(descriptionLines)
    val release = filename ?: described ?: releaseLine(nameLines)
    val corpus = (listOfNotNull(filename) + lines).joinToString("\n")

    val resolutionMatch = resolutionPattern.find(corpus)
    val explicit = resolutionMatch?.groupValues?.get(1)?.ifEmpty { null }?.lowercase()
    // "4k" and "UHD" name the same output size without the "p" spelling.
    val resolution = explicit ?: if (resolutionMatch != null) "2160p" else null

    val hintedSize = stream.behaviorHints.videoSize?.takeIf { it > 0 }
    val size: SourceSize? =
        when {
            hintedSize != null -> SourceSize.Bytes(hintedSize)
            else -> {
                val slash = slashSizePattern.find(corpus)
                val single = sizePattern.find(corpus)
                when {
                    slash != null -> SourceSize.Text(slash.value.replace(Regex("\\s+"), " "))
                    single != null ->
                        parseSizeBytes(single.groupValues[1], single.groupValues[2])?.let {
                            SourceSize.Bytes(it)
                        }
                    else -> null
                }
            }
        }

    val consumed =
        lines.filter { markerLine.containsMatchIn(it) || flagsOnlyLine.matches(it) || it == described }
    return SourceFields(
        resolution = resolution,
        releaseType = releaseTypes.firstOrNull { (p, _) -> p.containsMatchIn(corpus) }?.second,
        releaseGroup = release?.let(::detectGroup),
        languages = detectLanguages(corpus),
        audio = detectAudio(corpus),
        videoCodec = videoCodecs.firstOrNull { (p, _) -> p.containsMatchIn(corpus) }?.second,
        videoRange = detectRange(corpus),
        size = size,
        statedMegabits =
            bitratePattern.find(corpus)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull(),
        peers = peersPattern.find(corpus)?.groupValues?.get(1)?.toIntOrNull(),
        fallbackTitle = release ?: lines.firstOrNull() ?: unnamed,
        original =
            SourceFields.Original(
                name = name,
                description = description,
                filename = filename,
                remainder = descriptionLines.filter { it !in consumed },
            ),
    )
}
