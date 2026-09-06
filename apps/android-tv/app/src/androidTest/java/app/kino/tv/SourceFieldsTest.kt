package app.kino.tv

import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.StreamBehaviorHints
import com.stremio.core.types.resource.StreamDeepLinks
import org.junit.Assert.*
import org.junit.Test

/**
 * The same cases as the desktop client's `sourceFields.test.ts`, so both rows
 * read identical add-on text into identical fields.
 */
class SourceFieldsTest {
    private fun stream(
        name: String? = null,
        description: String? = null,
        filename: String? = null,
        videoSize: Long? = null,
    ) =
        Stream(
            source = Stream.Source.Url(Stream.Url("https://a.invalid/v.mkv")),
            name = name,
            description = description,
            behaviorHints =
                StreamBehaviorHints(notWebReady = false, filename = filename, videoSize = videoSize),
            deepLinks =
                StreamDeepLinks(
                    player = "",
                    externalPlayer = StreamDeepLinks.ExternalPlayerLink(),
                ),
        )

    private fun fields(
        name: String? = null,
        description: String? = null,
        filename: String? = null,
        videoSize: Long? = null,
    ) = sourceFields(stream(name, description, filename, videoSize), "Unnamed source")

    @Test
    fun readsASceneReleaseNameIntoComparableFields() {
        val fields =
            fields(
                name = "Torrentio\n4k DV",
                description =
                    "Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR\n👤 101 💾 54.33 GB ⚙️ TorrentGalaxy",
                filename =
                    "Some.Film.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR.mkv",
            )
        assertEquals("2160p", fields.resolution)
        assertEquals("Remux", fields.releaseType)
        assertEquals("FraMeSToR", fields.releaseGroup)
        assertEquals("DTS-HD MA 5.1", fields.audio)
        assertEquals("HEVC", fields.videoCodec)
        assertEquals("DV", fields.videoRange)
        assertEquals(101, fields.peers)
        assertEquals(emptyList<String>(), fields.languages)
        assertEquals(SourceSize.Bytes(Math.round(54.33 * (1L shl 30))), fields.size)
        assertEquals(emptyList<String>(), fields.original.remainder)
    }

    @Test
    fun keepsBracketsFromConfusingTheGroup() {
        val fields =
            fields(
                name = "Torrentio\n4k HDR",
                description =
                    "Some Film (1994) (2160p BluRay x265 HEVC 10bit HDR AAC 5.1 Tigole) [QxR]\n👤 39 💾 17.1 GB ⚙️ 1337x",
                filename = "Some Film (1994) (2160p BluRay x265 10bit HDR Tigole).mkv",
            )
        assertEquals("BluRay", fields.releaseType)
        assertEquals("HEVC", fields.videoCodec)
        assertEquals("HDR", fields.videoRange)
        assertEquals("AAC 5.1", fields.audio)
        assertNull(fields.releaseGroup)
    }

    @Test
    fun turnsFlagsIntoLanguagesAndCombinesRanges() {
        val fields =
            fields(
                name = "Torrentio\n4k DV | HDR",
                description =
                    "Le.ali.1994.UHDRip.2160p.Hevc.HDR.AC3.ITA.ENG.SUBS.LFi.mkv\n👤 6 💾 23.58 GB ⚙️ 1337x\n🇬🇧 / 🇮🇹",
            )
        assertEquals(listOf("EN", "IT"), fields.languages)
        assertEquals("DV + HDR", fields.videoRange)
        assertEquals("BDRip", fields.releaseType)
        assertEquals("AC3", fields.audio)
    }

    @Test
    fun fallsBackToThreeLetterTokensWithoutFlags() {
        val fields =
            fields(description = "Some Film 2160p H265 HDR10 DV ITA DTS 5.1 ENG AC3 5.1 SUB ITA ENG")
        assertEquals(listOf("IT", "EN"), fields.languages)
        assertEquals("DV + HDR10", fields.videoRange)
    }

    @Test
    fun neverInfersSdr() {
        assertNull(fields(description = "Film 1080p WEB-DL x264").videoRange)
        assertEquals("SDR", fields(description = "Film.2160p.MA.WEB-Group SDR 4k UHD").videoRange)
    }

    @Test
    fun showsASlashJoinedSizeAsWritten() {
        val fields = fields(description = "Show S01E03 1080p WEB-DL\n📦 6.8 / 13.6 GB")
        assertEquals(SourceSize.Text("6.8 / 13.6 GB"), fields.size)
        assertNull(estimatedMegabits(fields.size, 45))
    }

    @Test
    fun prefersTheStructuredSizeAndEstimatesBitrateFromRuntime() {
        val fields = fields(description = "Film 1080p 💾 9.99 GB", videoSize = 5L shl 30)
        assertEquals(SourceSize.Bytes(5L shl 30), fields.size)
        assertEquals(5.97, estimatedMegabits(fields.size, runtimeMinutes("2h 0min"))!!, 0.01)
        assertNull(estimatedMegabits(fields.size, runtimeMinutes(null)))
        assertEquals(12.5, fields(description = "Film 1080p 12.5 Mbps").statedMegabits!!, 0.0)
    }

    @Test
    fun leavesAPlainStreamUnstructured() {
        val fields = fields(name = "Debrid", description = "Instant stream")
        assertFalse(fields.structured)
        assertEquals("Instant stream", fields.fallbackTitle)
        assertEquals(emptyList<String>(), fields.original.remainder)
    }

    @Test
    fun keepsUnrecognisedTextForTheDetailsView() {
        val fields =
            fields(
                name = "Torrentio\n4k",
                description =
                    "Film (1994) Featurettes (2160p BluRay x265 10bit DTS 5.1 Joy) [UTR]\nFilm (1994) [2160p x265 10bit FS97 Joy].mkv\n👤 56 💾 7.13 GB ⚙️ 1337x",
            )
        assertEquals(listOf("Film (1994) [2160p x265 10bit FS97 Joy].mkv"), fields.original.remainder)
        assertEquals("2160p", fields.resolution)
    }

    @Test
    fun readsACodecFlushAgainstItsLayoutAndABracketedGroupBeforeTheExtension() {
        val fields =
            fields(
                description = "Film 1994 2160p BluRay\n👤 100 💾 6.91 GB ⚙️ YTS",
                filename = "Film.1994.2160p.4K.BluRay.x265.10bit.HDR.AAC5.1-[YTS.MX].mkv",
            )
        assertEquals("AAC 5.1", fields.audio)
        assertEquals("YTS.MX", fields.releaseGroup)
    }

    @Test
    fun doesNotReadATitleOrLayoutAsTheGroup() {
        assertNull(fields(description = "Spider-Man 2002 1080p").releaseGroup)
        assertNull(fields(description = "Film.1080p.AAC-5.1").releaseGroup)
    }

    @Test
    fun parsesRuntimeStrings() {
        assertEquals(142, runtimeMinutes("142 min"))
        assertEquals(142, runtimeMinutes("2h 22min"))
        assertEquals(45, runtimeMinutes("45"))
        assertNull(runtimeMinutes("unknown"))
        assertNull(runtimeMinutes(null))
    }
}
