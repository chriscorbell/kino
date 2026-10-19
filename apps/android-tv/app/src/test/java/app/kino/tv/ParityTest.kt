package app.kino.tv

import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.StreamBehaviorHints
import com.stremio.core.types.resource.StreamDeepLinks
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.experimental.runners.Enclosed
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * The shared cases in fixtures/parity, which the desktop's vitest suite reads too, so a rule both
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
}

private fun cases(fixture: String): List<JsonObject> {
    val text =
        checkNotNull(ParityTest::class.java.getResource("/$fixture.json")) { "missing $fixture.json" }
            .readText()
    return Json.parseToJsonElement(text).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
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

private fun json(value: Any?): JsonElement =
    when (value) {
        null -> JsonNull
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is List<*> -> JsonArray(value.map(::json))
        else -> error("no JSON form for $value")
    }
