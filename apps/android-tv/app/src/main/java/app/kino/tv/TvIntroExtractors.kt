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
import androidx.media3.extractor.ForwardingExtractorInput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.mkv.EbmlProcessor
import androidx.media3.extractor.mkv.MatroskaExtractor
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser

/**
 * Receives only metadata from the extractor Media3 actually selects for playback: what intro
 * discovery needs, and the frame rate a Matroska video track states, which Media3 does not read.
 */
internal class IntroDiscoverySession(
    private val onSelected: (Boolean) -> Unit,
    private val onChapters: (ByteArray?) -> Unit,
    private val onChapterOffset: (Long) -> Unit,
    private val onFrameRate: (Float) -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    private var released = false

    fun selected(matroska: Boolean) = post { onSelected(matroska) }

    fun chapters(payload: ByteArray?) = post { onChapters(payload) }

    fun chapterOffset(offset: Long) = post { onChapterOffset(offset) }

    fun frameRate(rate: Float) = post { onFrameRate(rate) }

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
                    SelectedExtractor(intro, intro, session)
                } else {
                    SelectedExtractor(extractor, null, session)
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
    private var reportedAbsent = false
    private var metadataComplete = false
    private var trackType = -1L
    private var defaultDurationNs = -1L
    private var reportedFrameRate = false
    private var seekHeadEnd = -1L
    private var indexesCues = false
    private var chainedIndex = -1L
    private var reachedCluster = false
    private var detour: Detour? = null

    /** Whether the input may still have to end early, at a boundary where a [Detour] seeks. */
    val mayDetour: Boolean
        get() = if (detour == null) !reachedCluster else detour != Detour.Done

    fun stopsAt(position: Long): Boolean =
        when (val step = detour) {
            is Detour.Leaving -> position == step.stopAt
            is Detour.Returning -> position == step.stopAt
            else -> false
        }

    /**
     * Where to seek when the input ended during a detour. Anything but its planned stops ends it
     * where it started, so a broken index leaves the file playing as Media3 would have played it.
     */
    fun afterEndOfInput(position: Long): Long? =
        when (val step = detour) {
            is Detour.Leaving ->
                if (position != step.stopAt) null
                else {
                    detour = Detour.Arriving(step.target, step.stopAt)
                    step.target
                }
            is Detour.Arriving -> step.returnTo.also { detour = Detour.Done }
            is Detour.Inside -> step.returnTo.also { detour = Detour.Done }
            is Detour.Returning -> step.returnTo.also { detour = Detour.Done }
            else -> null
        }

    /** Where to go back to when the detour arrived somewhere other than a SeekHead. */
    fun arrive(input: ExtractorInput): Long? {
        val step = detour as? Detour.Arriving ?: return null
        val id = ByteArray(4)
        val found =
            input.position == step.target &&
                input.peekFully(id, 0, id.size, true) &&
                id.fold(0) { value, byte -> (value shl 8) or (byte.toInt() and 0xff) } == SEEK_HEAD
        input.resetPeekPosition()
        if (found) {
            detour = Detour.Inside(step.returnTo)
            return null
        }
        detour = Detour.Done
        return step.returnTo
    }

    override fun getElementType(id: Int): Int =
        if (id == CHAPTERS) EbmlProcessor.ELEMENT_TYPE_BINARY else super.getElementType(id)

    override fun isLevel1Element(id: Int): Boolean = id == CHAPTERS || super.isLevel1Element(id)

    override fun startMasterElement(id: Int, contentPosition: Long, contentSize: Long) {
        if (id == SEGMENT) segmentContent = contentPosition
        if (id == SEEK_HEAD) seekHeadEnd = contentPosition + contentSize
        if (id == CLUSTER) reachedCluster = true
        if (id == TRACK_ENTRY) {
            trackType = -1L
            defaultDurationNs = -1L
        }
        // Muxers write Chapters, or a seek entry for them, before the first cluster. Most releases
        // have neither, and waiting for the end of the file to be sure would leave the community
        // lookup until the film was over. Chapters found after the clusters still take over.
        if (id == CLUSTER && !hasChapters && !hasIndexedChapters && !reportedAbsent) {
            reportedAbsent = true
            session.chapters(ByteArray(0))
        }
        if (id == SEEK) {
            inSeek = true
            seekId = -1
            seekPosition = -1L
        }
        super.startMasterElement(id, contentPosition, contentSize)
    }

    override fun endMasterElement(id: Int) {
        super.endMasterElement(id)
        // A video track's DefaultDuration is its frame time, known before the first frame; Media3
        // leaves Format.frameRate unset for Matroska, which would leave the TV's mode change until
        // three seconds of frames had been measured.
        if (id == TRACK_ENTRY && trackType == VIDEO_TRACK && defaultDurationNs > 0) {
            if (!reportedFrameRate) session.frameRate(1_000_000_000f / defaultDurationNs)
            reportedFrameRate = true
        }
        if (id == SEEK) {
            val target =
                if (segmentContent >= 0 && seekPosition >= 0)
                    runCatching { Math.addExact(segmentContent, seekPosition) }.getOrNull()
                else null
            if (seekId == CHAPTERS && segmentContent >= 0 && seekPosition >= 0) {
                hasIndexedChapters = true
                target?.let(session::chapterOffset)
            }
            if (seekId == CUES) indexesCues = true
            if (seekId == SEEK_HEAD && target != null) chainedIndex = target
            inSeek = false
        }
        // Some mkvmerge files index their Cues only from a second SeekHead near the end, which the
        // first one points at. Media3 never follows that pointer (androidx/media#1143), so it finds
        // no Cues at the first cluster and plays the whole file unseekable. Reading the second
        // SeekHead before then, and coming back, lets Media3 find the Cues as usual.
        if (id == SEEK_HEAD) {
            val step = detour
            if (step is Detour.Inside) {
                detour = Detour.Returning(seekHeadEnd, step.returnTo)
            } else if (step == null && !indexesCues && chainedIndex >= 0 && !reachedCluster) {
                detour = Detour.Leaving(seekHeadEnd, chainedIndex)
            }
        }
    }

    override fun integerElement(id: Int, value: Long) {
        if (inSeek && id == SEEK_POSITION) seekPosition = value
        if (id == TRACK_TYPE) trackType = value
        if (id == DEFAULT_DURATION) defaultDurationNs = value
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
        if (!hasChapters && !hasIndexedChapters && !reportedAbsent) session.chapters(ByteArray(0))
    }

    /** A read of a second SeekHead, made between two elements before the first cluster. */
    private sealed interface Detour {
        /** Reading on to the end of the first SeekHead, the boundary it comes back to. */
        class Leaving(val stopAt: Long, val target: Long) : Detour

        class Arriving(val target: Long, val returnTo: Long) : Detour

        class Inside(val returnTo: Long) : Detour

        class Returning(val stopAt: Long, val returnTo: Long) : Detour

        object Done : Detour
    }

    companion object {
        private const val CHAPTERS = 0x1043a770
        private const val CUES = 0x1c53bb6b
        private const val SEEK_HEAD = 0x114d9b74
        private const val SEGMENT = 0x18538067
        private const val CLUSTER = 0x1f43b675
        private const val SEEK = 0x4dbb
        private const val SEEK_ID = 0x53ab
        private const val SEEK_POSITION = 0x53ac
        private const val TRACK_ENTRY = 0xae
        private const val TRACK_TYPE = 0x83
        private const val DEFAULT_DURATION = 0x23e383
        private const val VIDEO_TRACK = 1L
        private const val MAX_CHAPTER_BYTES = 64 * 1024
    }
}

private class SelectedExtractor(
    extractor: Extractor,
    private val matroska: IntroMatroskaExtractor?,
    private val session: IntroDiscoverySession,
) : ForwardingExtractor(extractor) {
    override fun init(output: ExtractorOutput) {
        session.selected(matroska != null)
        super.init(output)
    }

    override fun read(input: ExtractorInput, seekPosition: PositionHolder): Int {
        if (matroska?.mayDetour != true) {
            return super.read(input, seekPosition).also { result ->
                if (result == Extractor.RESULT_END_OF_INPUT) matroska?.endOfInput()
            }
        }
        matroska.arrive(input)?.let { back ->
            seekPosition.position = back
            return Extractor.RESULT_SEEK
        }
        val result = super.read(EndAtDetour(input, matroska), seekPosition)
        if (result != Extractor.RESULT_END_OF_INPUT) return result
        matroska.afterEndOfInput(input.position)?.let { target ->
            seekPosition.position = target
            return Extractor.RESULT_SEEK
        }
        matroska.endOfInput()
        return result
    }
}

/**
 * Ends the input where the extractor needs a seek. MatroskaExtractor's read only returns a seek of
 * its own making, but it returns at the end of the input, between two elements.
 */
private class EndAtDetour(input: ExtractorInput, private val matroska: IntroMatroskaExtractor) :
    ForwardingExtractorInput(input) {
    override fun readFully(
        target: ByteArray,
        offset: Int,
        length: Int,
        allowEndOfInput: Boolean,
    ): Boolean =
        if (allowEndOfInput && matroska.stopsAt(position)) false
        else super.readFully(target, offset, length, allowEndOfInput)
}
