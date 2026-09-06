@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.ForwardingExtractor
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.mkv.EbmlProcessor
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser

/** Receives only metadata from the extractor Media3 actually selects for playback. */
internal class IntroDiscoverySession(
    private val onSelected: (Boolean) -> Unit,
    private val onChapters: (ByteArray?) -> Unit,
    private val onChapterOffset: (Long) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var released = false

    fun selected(matroska: Boolean) = post { onSelected(matroska) }

    fun chapters(payload: ByteArray?) = post { onChapters(payload) }

    fun chapterOffset(offset: Long) = post { onChapterOffset(offset) }

    @Synchronized
    private fun post(action: () -> Unit) {
        if (released) return
        main.post { synchronized(this) { if (!released) action() } }
    }

    @Synchronized
    fun release() {
        released = true
    }
}

internal class IntroExtractorsFactory(private val session: IntroDiscoverySession) :
    ExtractorsFactory {
    private val defaults = DefaultExtractorsFactory()
    private var parser: SubtitleParser.Factory = DefaultSubtitleParserFactory()
    private var transcodeText = true
    private var matroskaFlags = 0

    @Synchronized
    override fun createExtractors(): Array<Extractor> = createExtractors(Uri.EMPTY, emptyMap())

    @Synchronized
    override fun createExtractors(
        uri: Uri,
        responseHeaders: Map<String, List<String>>,
    ): Array<Extractor> =
        defaults
            .createExtractors(uri, responseHeaders)
            .map { extractor ->
                if (extractor is MatroskaExtractor) {
                    val flags =
                        matroskaFlags or
                            if (transcodeText) 0 else MatroskaExtractor.FLAG_EMIT_RAW_SUBTITLE_DATA
                    val intro = IntroMatroskaExtractor(parser, flags, session)
                    SelectedExtractor(intro, true, session, intro::endOfInput)
                } else {
                    SelectedExtractor(extractor, false, session)
                }
            }
            .toTypedArray()

    @Synchronized
    override fun setSubtitleParserFactory(value: SubtitleParser.Factory): ExtractorsFactory {
        parser = value
        defaults.setSubtitleParserFactory(value)
        return this
    }

    @Deprecated("Media3 interface method")
    @Synchronized
    override fun experimentalSetTextTrackTranscodingEnabled(value: Boolean): ExtractorsFactory {
        transcodeText = value
        defaults.experimentalSetTextTrackTranscodingEnabled(value)
        return this
    }

    @Synchronized
    override fun experimentalSetCodecsToParseWithinGopSampleDependencies(
        value: Int
    ): ExtractorsFactory {
        defaults.experimentalSetCodecsToParseWithinGopSampleDependencies(value)
        return this
    }

    @Synchronized
    fun setMatroskaExtractorFlags(value: Int): IntroExtractorsFactory {
        matroskaFlags = value
        defaults.setMatroskaExtractorFlags(value)
        return this
    }
}

private class IntroMatroskaExtractor(
    parser: SubtitleParser.Factory,
    flags: Int,
    private val session: IntroDiscoverySession,
) : MatroskaExtractor(parser, flags) {
    private var segmentContent = -1L
    private var inSeek = false
    private var seekId = -1
    private var seekPosition = -1L
    private var hasChapters = false
    private var hasIndexedChapters = false
    private var metadataComplete = false

    override fun getElementType(id: Int): Int =
        if (id == CHAPTERS) EbmlProcessor.ELEMENT_TYPE_BINARY else super.getElementType(id)

    override fun isLevel1Element(id: Int): Boolean = id == CHAPTERS || super.isLevel1Element(id)

    override fun startMasterElement(id: Int, contentPosition: Long, contentSize: Long) {
        if (id == SEGMENT) segmentContent = contentPosition
        if (id == SEEK) {
            inSeek = true
            seekId = -1
            seekPosition = -1L
        }
        super.startMasterElement(id, contentPosition, contentSize)
    }

    override fun endMasterElement(id: Int) {
        super.endMasterElement(id)
        if (id == SEEK) {
            if (seekId == CHAPTERS && segmentContent >= 0 && seekPosition >= 0) {
                hasIndexedChapters = true
                runCatching { Math.addExact(segmentContent, seekPosition) }
                    .getOrNull()
                    ?.let(session::chapterOffset)
            }
            inSeek = false
        }
    }

    override fun integerElement(id: Int, value: Long) {
        if (inSeek && id == SEEK_POSITION) seekPosition = value
        super.integerElement(id, value)
    }

    override fun binaryElement(id: Int, contentSize: Int, input: ExtractorInput) {
        if (id == SEEK_ID && inSeek && contentSize in 1..4) {
            val bytes = ByteArray(contentSize)
            input.peekFully(bytes, 0, contentSize)
            input.resetPeekPosition()
            seekId = bytes.fold(0) { value, byte -> (value shl 8) or (byte.toInt() and 0xff) }
        }
        if (id != CHAPTERS) {
            super.binaryElement(id, contentSize, input)
            return
        }
        hasChapters = true
        if (contentSize !in 0..MAX_CHAPTER_BYTES) {
            input.skipFully(contentSize)
            session.chapters(null)
            return
        }
        val payload = ByteArray(contentSize)
        input.readFully(payload, 0, contentSize)
        session.chapters(payload)
    }

    fun endOfInput() {
        if (metadataComplete) return
        metadataComplete = true
        if (!hasChapters && !hasIndexedChapters) session.chapters(ByteArray(0))
    }

    companion object {
        private const val CHAPTERS = 0x1043a770
        private const val SEGMENT = 0x18538067
        private const val SEEK = 0x4dbb
        private const val SEEK_ID = 0x53ab
        private const val SEEK_POSITION = 0x53ac
        private const val MAX_CHAPTER_BYTES = 64 * 1024
    }
}

private class SelectedExtractor(
    extractor: Extractor,
    private val matroska: Boolean,
    private val session: IntroDiscoverySession,
    private val onEndOfInput: () -> Unit = {},
) : ForwardingExtractor(extractor) {
    override fun init(output: ExtractorOutput) {
        session.selected(matroska)
        super.init(output)
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int =
        super.read(input, seekPosition).also { result ->
            if (result == Extractor.RESULT_END_OF_INPUT) onEndOfInput()
        }
}
