package app.kino.tv

import java.nio.charset.CharacterCodingException

internal data class TvIntroMarker(val startMs: Long, val endMs: Long, val source: Source) {
    enum class Source {
        Embedded,
        Community,
    }
}

internal sealed interface IntroDiscovery {
    data class Found(val marker: TvIntroMarker) : IntroDiscovery

    data object Absent : IntroDiscovery

    data object Unknown : IntroDiscovery
}

/** Reads one complete Matroska Chapters payload within the limits used by intro discovery. */
internal object MatroskaChapters {
    private const val MAX_ATOMS = 512
    private const val MAX_EDITIONS = 16
    private const val MAX_DEPTH = 8
    private const val MAX_TITLE_BYTES = 1024
    private val openingLabels = setOf("intro", "introduction", "opening", "opening credits", "op")

    private data class Element(val id: Long, val content: Int, val end: Int)

    private data class Atom(
        var uid: Long? = null,
        var startNs: Long? = null,
        var endNs: Long? = null,
        var skipType: Long? = null,
        var enabled: Boolean = true,
        var hidden: Boolean = false,
        val titles: MutableList<String> = mutableListOf(),
    )

    private data class Edition(
        var default: Boolean = false,
        var ordered: Boolean = false,
        var unsupported: Boolean = false,
        val atoms: MutableList<Atom> = mutableListOf(),
    )

    fun parse(payload: ByteArray, durationMs: Long): IntroDiscovery {
        if (payload.size > 64 * 1024 || durationMs <= 0) return IntroDiscovery.Unknown
        return try {
            val editions = mutableListOf<Edition>()
            var at = 0
            while (at < payload.size) {
                val element = element(payload, at, payload.size)
                if (element.id == EDITION_ENTRY) {
                    require(editions.size < MAX_EDITIONS)
                    editions += edition(payload, element, 1)
                }
                at = element.end
            }
            require(editions.count { it.default } <= 1)
            val selected =
                editions.firstOrNull { it.default }
                    ?: editions.firstOrNull()
                    ?: return IntroDiscovery.Absent
            if (selected.ordered || selected.unsupported) return IntroDiscovery.Unknown
            val uids = selected.atoms.map { requireNotNull(it.uid) }
            require(uids.distinct().size == uids.size)
            marker(selected.atoms, durationMs)
        } catch (_: IllegalArgumentException) {
            IntroDiscovery.Unknown
        } catch (_: ArithmeticException) {
            IntroDiscovery.Unknown
        } catch (_: CharacterCodingException) {
            IntroDiscovery.Unknown
        }
    }

    private fun edition(bytes: ByteArray, outer: Element, depth: Int): Edition {
        require(depth <= MAX_DEPTH)
        val result = Edition()
        val scalars = mutableSetOf<Long>()
        var at = outer.content
        while (at < outer.end) {
            val child = element(bytes, at, outer.end)
            when (child.id) {
                EDITION_DEFAULT -> result.default = scalar(bytes, child, scalars) != 0L
                EDITION_ORDERED -> result.ordered = scalar(bytes, child, scalars) != 0L
                EDITION_HIDDEN -> if (scalar(bytes, child, scalars) != 0L) result.unsupported = true
                CHAPTER_ATOM -> {
                    require(result.atoms.size < MAX_ATOMS)
                    result.atoms += atom(bytes, child, depth + 1, result)
                }
            }
            at = child.end
        }
        return result
    }

    private fun atom(bytes: ByteArray, outer: Element, depth: Int, edition: Edition): Atom {
        require(depth <= MAX_DEPTH)
        val result = Atom()
        val scalars = mutableSetOf<Long>()
        var at = outer.content
        while (at < outer.end) {
            val child = element(bytes, at, outer.end)
            when (child.id) {
                CHAPTER_UID -> result.uid = scalar(bytes, child, scalars)
                CHAPTER_START -> result.startNs = scalar(bytes, child, scalars)
                CHAPTER_END -> result.endNs = scalar(bytes, child, scalars)
                CHAPTER_SKIP_TYPE -> result.skipType = scalar(bytes, child, scalars)
                CHAPTER_ENABLED -> result.enabled = scalar(bytes, child, scalars) != 0L
                CHAPTER_HIDDEN -> result.hidden = scalar(bytes, child, scalars) != 0L
                CHAPTER_DISPLAY -> display(bytes, child, depth + 1)?.let(result.titles::add)
                CHAPTER_ATOM,
                CHAPTER_SEGMENT_UUID,
                CHAPTER_SEGMENT_EDITION_UID,
                CHAPTER_TRACK,
                CHAPTER_PROCESS -> edition.unsupported = true
            }
            at = child.end
        }
        require(result.uid != null && result.startNs != null)
        return result
    }

    private fun display(bytes: ByteArray, outer: Element, depth: Int): String? {
        require(depth <= MAX_DEPTH)
        var title: String? = null
        var at = outer.content
        while (at < outer.end) {
            val child = element(bytes, at, outer.end)
            if (child.id == CHAPTER_STRING) {
                require(title == null && child.end - child.content <= MAX_TITLE_BYTES)
                title =
                    bytes.decodeToString(child.content, child.end, throwOnInvalidSequence = true)
            }
            at = child.end
        }
        return title
    }

    private fun marker(atoms: List<Atom>, durationMs: Long): IntroDiscovery {
        val sorted = atoms.sortedBy { it.startNs }
        require(sorted.zipWithNext().none { (left, right) -> left.startNs == right.startNs })
        val candidates =
            sorted.mapIndexedNotNull { index, atom ->
                val explicit = atom.skipType == OPENING_SKIP_TYPE
                val labelled =
                    atom.skipType == null &&
                        atom.titles.any { it.trim().lowercase() in openingLabels }
                if (!explicit && !labelled) return@mapIndexedNotNull null
                if (!atom.enabled || atom.hidden) return IntroDiscovery.Unknown
                val start = requireNotNull(atom.startNs) / 1_000_000L
                val inferredEnd =
                    if (explicit) {
                        sorted.drop(index + 1).firstOrNull { it.skipType != null }?.startNs
                    } else {
                        sorted.getOrNull(index + 1)?.startNs
                    }
                val end = (atom.endNs ?: inferredEnd)?.div(1_000_000L) ?: durationMs
                if (start < 0 || end > durationMs || end - start !in 5_000L..200_000L)
                    return IntroDiscovery.Unknown
                TvIntroMarker(start, end, TvIntroMarker.Source.Embedded)
            }
        return when (candidates.size) {
            0 -> IntroDiscovery.Absent
            1 -> IntroDiscovery.Found(candidates.single())
            else -> IntroDiscovery.Unknown
        }
    }

    private fun scalar(bytes: ByteArray, element: Element, seen: MutableSet<Long>): Long {
        require(seen.add(element.id))
        val length = element.end - element.content
        require(length in 1..8 && (length < 8 || bytes[element.content].toInt() and 0x80 == 0))
        var value = 0L
        for (index in element.content until element.end) value =
            (value shl 8) or (bytes[index].toLong() and 0xff)
        return value
    }

    private fun element(bytes: ByteArray, start: Int, limit: Int): Element {
        require(start < limit)
        var cursor = start
        val idWidth = vintWidth(bytes[cursor].toInt() and 0xff, 4)
        require(cursor + idWidth <= limit)
        var id = 0L
        repeat(idWidth) { id = (id shl 8) or (bytes[cursor++].toLong() and 0xff) }
        require(cursor < limit)
        val sizeWidth = vintWidth(bytes[cursor].toInt() and 0xff, 8)
        require(cursor + sizeWidth <= limit)
        var size = bytes[cursor++].toLong() and ((0x80 ushr (sizeWidth - 1)) - 1).toLong()
        repeat(sizeWidth - 1) {
            size = Math.addExact(Math.multiplyExact(size, 256), bytes[cursor++].toLong() and 0xff)
        }
        require(size != (1L shl (sizeWidth * 7)) - 1 && size <= Int.MAX_VALUE)
        val end = Math.addExact(cursor, size.toInt())
        require(end <= limit)
        return Element(id, cursor, end)
    }

    private fun vintWidth(first: Int, maximum: Int): Int {
        var mask = 0x80
        for (width in 1..maximum) {
            if (first and mask != 0) return width
            mask = mask ushr 1
        }
        throw IllegalArgumentException("Invalid EBML VINT")
    }

    private const val EDITION_ENTRY = 0x45b9L
    private const val EDITION_HIDDEN = 0x45bdL
    private const val EDITION_DEFAULT = 0x45dbL
    private const val EDITION_ORDERED = 0x45ddL
    private const val CHAPTER_ATOM = 0xb6L
    private const val CHAPTER_UID = 0x73c4L
    private const val CHAPTER_START = 0x91L
    private const val CHAPTER_END = 0x92L
    private const val CHAPTER_SKIP_TYPE = 0x4588L
    private const val CHAPTER_ENABLED = 0x4598L
    private const val CHAPTER_HIDDEN = 0x98L
    private const val CHAPTER_DISPLAY = 0x80L
    private const val CHAPTER_STRING = 0x85L
    private const val CHAPTER_SEGMENT_UUID = 0x6e67L
    private const val CHAPTER_SEGMENT_EDITION_UID = 0x6ebcL
    private const val CHAPTER_TRACK = 0x8fL
    private const val CHAPTER_PROCESS = 0x6944L
    private const val OPENING_SKIP_TYPE = 1L
}
