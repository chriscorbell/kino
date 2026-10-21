package app.kino.tv

import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.StreamBehaviorHints
import com.stremio.core.types.resource.StreamDeepLinks
import com.stremio.core.types.resource.StreamProxyHeaders
import com.stremio.core.types.resource.Video
import com.stremio.core.types.resource.VideoDeepLinks
import java.io.File
import java.math.BigInteger
import java.nio.ByteBuffer
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.experimental.runners.Enclosed
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The shared cases in fixtures/parity, which the desktop's tests read too, so a rule both
 * clients implement cannot change on one side without the same case failing on the other.
 */
@RunWith(Enclosed::class)
class ParityTest {
    @RunWith(Parameterized::class)
    class SourceFieldCases(@Suppress("unused") private val name: String, private val case: JsonObject) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() = cases("source-fields").map { arrayOf(it.string("name"), it) }
        }

        @Test
        fun matchesTheSharedCase() {
            val input = case.getValue("input").jsonObject
            val stream =
                Stream(
                    source = Stream.Source.Url(Stream.Url("https://a.invalid/v.mkv")),
                    name = input.string("name"),
                    description = input.string("description"),
                    behaviorHints =
                        StreamBehaviorHints(
                            notWebReady = false,
                            filename = input.string("filename"),
                            videoSize = input["videoSize"]?.jsonPrimitive?.longOrNull,
                        ),
                    deepLinks =
                        StreamDeepLinks(player = "", externalPlayer = StreamDeepLinks.ExternalPlayerLink()),
                )
            val fields = sourceFields(stream, "Unnamed source")
            // The labels a viewer reads, built from the app's own string templates.
            val observed =
                mapOf(
                    "resolution" to fields.resolution,
                    "releaseType" to fields.releaseType,
                    "releaseGroup" to fields.releaseGroup,
                    "languages" to fields.languages,
                    "audio" to fields.audio,
                    "videoCodec" to fields.videoCodec,
                    "videoRange" to fields.videoRange,
                    "peers" to fields.peers,
                    "fallbackTitle" to fields.fallbackTitle,
                    "structured" to fields.structured,
                    "sizeLabel" to
                        sizeLabel(fields.size, string("format_gigabytes"), string("format_megabytes")),
                    "bitrateLabel" to
                        bitrateLabel(
                            fields,
                            input.string("runtime"),
                            string("format_megabits"),
                            string("format_estimated_megabits"),
                        ),
                    "filename" to fields.original.filename,
                    "remainder" to fields.original.remainder,
                )
            for ((key, expected) in case.getValue("expect").jsonObject) {
                check(key in observed) { "the TV test does not observe $key" }
                assertEquals(key, expected, json(observed[key]))
            }
        }
    }

    @RunWith(Parameterized::class)
    class VersionCases(@Suppress("unused") private val name: String, private val case: JsonObject) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() =
                cases("versions").map {
                    arrayOf("${it.string("left")} against ${it.string("right")}", it)
                }
        }

        @Test
        fun matchesTheSharedCase() {
            val left = case.string("left")!!
            val right = case.string("right")!!
            val order = case.getValue("expect").jsonPrimitive.intOrNull
            assertEquals(order, compareKinoVersions(left, right))
            assertEquals(order?.let { -it }, compareKinoVersions(right, left))
        }
    }

    @RunWith(Parameterized::class)
    class SeasonCases(@Suppress("unused") private val name: String, private val case: JsonObject) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() = cases("seasons").map { arrayOf(it.string("name"), it) }
        }

        @Test
        fun matchesTheSharedCase() {
            val videos = case.getValue("videos").jsonArray.map { video(it.jsonObject) }
            val observed =
                availableSeasons(videos).map { season ->
                    mapOf(
                        "season" to season,
                        "episodes" to seasonEpisodes(videos, season).map { it.id },
                    )
                }
            assertEquals(case.getValue("expect"), json(observed))
        }
    }

    @RunWith(Parameterized::class)
    class UpNextCases(@Suppress("unused") private val name: String, private val case: JsonObject) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() = cases("up-next").map { arrayOf(it.string("name"), it) }
        }

        @Test
        fun matchesTheSharedCase() {
            assertEquals(
                case.getValue("expect").jsonPrimitive.boolean,
                inUpNextWindow(case.long("positionMs"), case.long("durationMs")),
            )
        }
    }

    @RunWith(Parameterized::class)
    class IntroChapterCases(
        @Suppress("unused") private val name: String,
        private val case: JsonObject,
    ) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() = cases("intro-chapters").map { arrayOf(it.string("name"), it) }
        }

        @Test
        fun matchesTheSharedCase() {
            val discovery =
                MatroskaChapters.parse(
                    chaptersPayload(case.getValue("chapters").jsonArray),
                    case.long("durationMs"),
                )
            val observed =
                when (discovery) {
                    is IntroDiscovery.Found ->
                        mapOf(
                            "result" to "found",
                            "startMs" to discovery.marker.startMs,
                            "endMs" to discovery.marker.endMs,
                        )
                    IntroDiscovery.Absent -> mapOf("result" to "absent")
                    IntroDiscovery.Unknown -> mapOf("result" to "unknown")
                }
            assertEquals(case.getValue("expect"), json(observed))
        }
    }

    /**
     * Chapter fields the TV reads from the Matroska Chapters element. The desktop sees only
     * libmpv's chapter list, so these cases are not shared (ADR 0033, Matroska chapter fields).
     */
    class TvOnlyIntroChapterCases {
        private fun discovery(introFlags: Map<String, Long> = emptyMap(), ordered: Boolean = false) =
            MatroskaChapters.parse(
                chaptersPayload(
                    JsonArray(
                        listOf(
                            chapter("Prologue", 0),
                            chapter("Intro", 20_000, introFlags),
                            chapter("", 87_000),
                        )
                    ),
                    ordered,
                ),
                2_400_000,
            )

        private fun chapter(title: String, startMs: Long, flags: Map<String, Long> = emptyMap()) =
            JsonObject(
                mapOf("title" to JsonPrimitive(title), "startMs" to JsonPrimitive(startMs)) +
                    flags.mapValues { (_, value) -> JsonPrimitive(value) }
            )

        // The same chapters without flags find the intro, so each flag alone is what leaves it
        // unknown below.
        @Test
        fun anIntroChapterWithoutFlagsIsFound() {
            assertEquals(
                IntroDiscovery.Found(TvIntroMarker(20_000, 87_000, TvIntroMarker.Source.Embedded)),
                discovery(),
            )
        }

        @Test
        fun aDisabledIntroChapterLeavesTheIntroUnknown() {
            assertEquals(IntroDiscovery.Unknown, discovery(introFlags = mapOf("enabled" to 0L)))
        }

        @Test
        fun aHiddenIntroChapterLeavesTheIntroUnknown() {
            assertEquals(IntroDiscovery.Unknown, discovery(introFlags = mapOf("hidden" to 1L)))
        }

        @Test
        fun anOrderedEditionLeavesTheIntroUnknown() {
            assertEquals(IntroDiscovery.Unknown, discovery(ordered = true))
        }
    }

    @RunWith(Parameterized::class)
    class ProxyHeaderCases(@Suppress("unused") private val name: String, private val case: JsonObject) {
        companion object {
            @JvmStatic
            @Parameterized.Parameters(name = "{0}")
            fun cases() = cases("proxy-headers").map { arrayOf(it.string("name"), it) }
        }

        @Test
        fun matchesTheSharedCase() {
            val headers = case.getValue("headers").jsonObject.mapValues { it.value.jsonPrimitive.content }
            val fill =
                case["fill"]?.jsonObject?.let { fill ->
                    val value = fill.string("value")!!.repeat(fill.long("repeat").toInt())
                    (1..fill.long("count")).associate { "X-Fill-$it" to value }
                }
            val filled = headers + fill.orEmpty()
            fun source(stream: Stream.Source<*>) =
                Source(
                    "Fixture provider",
                    Stream(
                        source = stream,
                        behaviorHints =
                            StreamBehaviorHints(
                                notWebReady = false,
                                proxyHeaders = StreamProxyHeaders(request = filled.toMap<String?, String?>()),
                            ),
                        deepLinks =
                            StreamDeepLinks(player = "", externalPlayer = StreamDeepLinks.ExternalPlayerLink()),
                    ),
                    ResourceRequest("https://addon.invalid/manifest.json", ResourcePath("stream", "movie", "tt1")),
                )
            val refused = case.getValue("refused").jsonPrimitive.boolean
            val direct = source(Stream.Source.Url(Stream.Url("https://media.invalid/v.mkv")))
            assertEquals(if (refused) null else filled, direct.requestHeaders)
            assertTrue("A direct source stays playable, to fail as it starts", direct.playable)
            val torrent = source(Stream.Source.Tramvai(Stream.Tramvai(infoHash = "0".repeat(40))))
            assertEquals("A torrent sends no add-on headers", emptyMap<String, String>(), torrent.requestHeaders)
        }
    }
}

// A video as Core lists it, where season and episode come together or not at all.
private fun video(listed: JsonObject) =
    Video(
        id = listed.string("id")!!,
        title = "",
        seriesInfo =
            listed["season"]?.let { Video.SeriesInfo(it.jsonPrimitive.long, listed.long("episode")) },
        upcoming = false,
        watched = false,
        currentVideo = false,
        deepLinks =
            VideoDeepLinks(
                metaDetailsVideos = "",
                metaDetailsStreams = "",
                externalPlayer = VideoDeepLinks.ExternalPlayerLink(),
            ),
    )

// The Chapters payload the Matroska extractor hands to MatroskaChapters: one edition whose
// chapters each carry one title, and an end time or enabled and hidden flags when the case gives
// them.
private fun chaptersPayload(chapters: JsonArray, ordered: Boolean = false): ByteArray {
    val atoms =
        chapters.mapIndexed { index, item ->
            val chapter = item.jsonObject
            val title = ebml(CHAP_STRING, chapter.string("title")!!.encodeToByteArray())
            fun field(key: String, id: Long, scale: Long = 1) =
                chapter[key]?.let { ebml(id, it.jsonPrimitive.long * scale) } ?: ByteArray(0)
            ebml(
                CHAPTER_ATOM,
                ebml(CHAPTER_UID, index + 1L) +
                    ebml(CHAPTER_TIME_START, chapter.long("startMs") * 1_000_000) +
                    field("endMs", CHAPTER_TIME_END, 1_000_000) +
                    field("enabled", CHAPTER_FLAG_ENABLED) +
                    field("hidden", CHAPTER_FLAG_HIDDEN) +
                    ebml(CHAPTER_DISPLAY, title),
            )
        }
    val flags = if (ordered) ebml(EDITION_FLAG_ORDERED, 1L) else ByteArray(0)
    return ebml(EDITION_ENTRY, atoms.fold(flags, ByteArray::plus))
}

// Every size is written as an eight-byte VINT, which the parser accepts for any length.
private fun ebml(id: Long, content: ByteArray) =
    BigInteger.valueOf(id).toByteArray().dropWhile { it == 0.toByte() }.toByteArray() +
        ByteBuffer.allocate(8).putLong(content.size.toLong()).array().also { it[0] = 1 } +
        content

private fun ebml(id: Long, value: Long) = ebml(id, ByteBuffer.allocate(8).putLong(value).array())

private const val EDITION_ENTRY = 0x45b9L
private const val CHAPTER_ATOM = 0xb6L
private const val CHAPTER_UID = 0x73c4L
private const val CHAPTER_TIME_START = 0x91L
private const val CHAPTER_TIME_END = 0x92L
private const val CHAPTER_FLAG_ENABLED = 0x4598L
private const val CHAPTER_FLAG_HIDDEN = 0x98L
private const val EDITION_FLAG_ORDERED = 0x45ddL
private const val CHAPTER_DISPLAY = 0x80L
private const val CHAP_STRING = 0x85L

private fun cases(fixture: String): List<JsonObject> {
    val text =
        checkNotNull(ParityTest::class.java.getResource("/$fixture.json")) { "missing $fixture.json" }
            .readText()
    return Json.parseToJsonElement(text).jsonObject.getValue("cases").jsonArray.map {
        forTv(it).jsonObject
    }
}

// An expected value the clients differ on by design names its entry in ADR 0033 and gives each
// platform's result. This suite takes the TV's.
private fun forTv(value: JsonElement): JsonElement =
    when (value) {
        is JsonArray -> JsonArray(value.map(::forTv))
        is JsonObject ->
            if ("intended" !in value) JsonObject(value.mapValues { (_, item) -> forTv(item) })
            else {
                val desktop = value["desktop"]
                val tv = value["tv"]
                check(desktop != null && tv != null && desktop != tv) {
                    "${value["intended"]} must give a different desktop and tv value"
                }
                tv
            }
        else -> value
    }

// The hand-written resources and the ones scripts/generate-tv-strings.mjs writes from en-US.ts.
private val strings: Map<String, String> by lazy {
    listOf(
            "src/main/res/values/strings.xml",
            "../../../build/android-strings/res/values/strings_shared.xml",
        )
        .flatMap { path ->
            val nodes =
                DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(File(path))
                    .getElementsByTagName("string")
            (0 until nodes.length).map { index ->
                val node = nodes.item(index)
                node.attributes.getNamedItem("name").nodeValue to androidText(node.textContent)
            }
        }
        .toMap()
}

private val androidEscape = Regex("""\\(.)|"""")

// What getString returns for a resource's text: the resource compiler drops unescaped double
// quotes and resolves backslash escapes.
private fun androidText(raw: String) =
    androidEscape.replace(raw) { match -> match.groupValues[1].let { if (it == "n") "\n" else it } }

private fun string(name: String) = strings.getValue(name)

private fun JsonObject.string(key: String) =
    (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.long(key: String) = getValue(key).jsonPrimitive.long

private fun json(value: Any?): JsonElement =
    when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is List<*> -> JsonArray(value.map(::json))
        is Map<*, *> -> JsonObject(value.entries.associate { (key, item) -> key as String to json(item) })
        else -> error("no JSON form for $value")
    }
