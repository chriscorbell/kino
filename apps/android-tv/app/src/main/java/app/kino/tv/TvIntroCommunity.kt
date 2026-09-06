package app.kino.tv

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

internal data class IntroIdentity(
    val durationMs: Long,
    val imdbId: String? = null,
    val tmdbId: Long? = null,
    val season: Int? = null,
    val episode: Int? = null,
)

internal class IntroCommunityClient(
    endpoint: String = DEFAULT_ENDPOINT,
    client: OkHttpClient = OkHttpClient(),
) {
    private val endpoint = endpoint.toHttpUrl()
    private val http =
        client
            .newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()

    suspend fun lookup(identity: IntroIdentity): TvIntroMarker? =
        withTimeoutOrNull(5_000) {
            if (!identity.valid()) return@withTimeoutOrNull null
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            val base =
                endpoint
                    .newBuilder()
                    .also { query ->
                        if (identity.imdbId != null)
                            query.addQueryParameter("imdb_id", identity.imdbId)
                        else query.addQueryParameter("tmdb_id", identity.tmdbId.toString())
                        query.addQueryParameter("duration_ms", identity.durationMs.toString())
                        if (identity.season != null) {
                            query.addQueryParameter("season", identity.season.toString())
                            query.addQueryParameter("episode", identity.episode.toString())
                        }
                    }
                    .build()
            val versions =
                get(base.newBuilder().addQueryParameter("list_versions", "true").build(), deadline)
                    ?: return@withTimeoutOrNull null
            val listedIdentity =
                responseIdentity(versions, identity) ?: return@withTimeoutOrNull null
            val listed = versions.optJSONArray("versions") ?: return@withTimeoutOrNull null
            if (listed.length() > MAX_VERSIONS) return@withTimeoutOrNull null
            var exact = 0
            for (index in 0 until listed.length()) {
                val item = listed.optJSONObject(index) ?: return@withTimeoutOrNull null
                val runtime = exactLong(item.opt("duration_ms")) ?: return@withTimeoutOrNull null
                if (runtime < 0) return@withTimeoutOrNull null
                if (runtime == identity.durationMs && runtime > 0) exact++
            }
            if (exact != 1) return@withTimeoutOrNull null
            val media =
                get(base.newBuilder().addQueryParameter("merge_unknown", "false").build(), deadline)
                    ?: return@withTimeoutOrNull null
            if (responseIdentity(media, identity) != listedIdentity) return@withTimeoutOrNull null
            marker(
                media.optJSONArray("intro") ?: return@withTimeoutOrNull null,
                identity.durationMs,
            )
        }

    private data class ResolvedIdentity(
        val type: String,
        val season: Int?,
        val episode: Int?,
        val tmdbId: Long?,
    )

    private fun responseIdentity(value: JSONObject, expected: IntroIdentity): ResolvedIdentity? {
        val type = value.opt("type") as? String ?: return null
        val season =
            optionalInt(value, "season") ?: if (value.isNull("season")) null else return null
        val episode =
            optionalInt(value, "episode") ?: if (value.isNull("episode")) null else return null
        if (type != if (expected.season == null) "movie" else "tv") return null
        if (season != expected.season || episode != expected.episode) return null
        val tmdb =
            exactLong(value.opt("tmdb_id")) ?: if (value.isNull("tmdb_id")) null else return null
        if (tmdb == null || tmdb !in 1..MAX_TMDB_ID) return null
        if (expected.tmdbId != null && tmdb != expected.tmdbId) return null
        return ResolvedIdentity(type, season, episode, tmdb)
    }

    private fun marker(values: JSONArray, durationMs: Long): TvIntroMarker? {
        val candidates = mutableListOf<Pair<Long, Long?>>()
        for (index in 0 until values.length()) {
            val item = values.optJSONObject(index) ?: return null
            if (!item.has("start_ms") || !item.has("end_ms")) return null
            val start =
                if (item.isNull("start_ms")) 0L else exactLong(item.opt("start_ms")) ?: return null
            val end =
                if (item.isNull("end_ms")) null else exactLong(item.opt("end_ms")) ?: return null
            if (start < 0 || end?.let { it < 0 } == true) return null
            if (
                item.has("confidence") &&
                    !item.isNull("confidence") &&
                    (item.opt("confidence") !is Number ||
                        !(item.opt("confidence") as Number).toDouble().isFinite())
            )
                return null
            if (
                item.has("submission_count") &&
                    !item.isNull("submission_count") &&
                    exactLong(item.opt("submission_count")) == null
            )
                return null
            candidates += start to end
        }
        for ((start, end) in candidates) {
            if (end == null) continue
            if (start >= 0 && end <= durationMs && end - start in 5_000L..200_000L)
                return TvIntroMarker(start, end, TvIntroMarker.Source.Community)
        }
        return null
    }

    private suspend fun get(url: HttpUrl, deadline: Long): JSONObject? =
        suspendCancellableCoroutine { continuation ->
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) {
                continuation.resume(null)
                return@suspendCancellableCoroutine
            }
            val call =
                runCatching {
                        http.newCall(
                            Request.Builder()
                                .url(url)
                                .header("Accept", "application/json")
                                .get()
                                .build()
                        )
                    }
                    .getOrNull()
            if (call == null) {
                continuation.resume(null)
                return@suspendCancellableCoroutine
            }
            call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: java.io.IOException) {
                        if (continuation.isActive) continuation.resume(null)
                    }

                    override fun onResponse(call: Call, response: Response) {
                        val value =
                            runCatching {
                                    response.use {
                                        if (
                                            it.code !in 200..299 || it.isRedirect || it.body == null
                                        )
                                            return@use null
                                        val declared = it.body!!.contentLength()
                                        if (declared > MAX_RESPONSE_BYTES) return@use null
                                        val bytes =
                                            readBounded(it.body!!.byteStream(), MAX_RESPONSE_BYTES)
                                                ?: return@use null
                                        val text =
                                            Charsets.UTF_8.newDecoder()
                                                .onMalformedInput(CodingErrorAction.REPORT)
                                                .onUnmappableCharacter(CodingErrorAction.REPORT)
                                                .decode(ByteBuffer.wrap(bytes))
                                                .toString()
                                        runCatching { JSONObject(text) }.getOrNull()
                                    }
                                }
                                .getOrNull()
                        if (continuation.isActive) continuation.resume(value)
                    }
                }
            )
        }

    private fun IntroIdentity.valid(): Boolean {
        if (durationMs <= 0) return false
        if ((imdbId == null) == (tmdbId == null)) return false
        if (imdbId != null && !imdbId.matches(Regex("tt[0-9]{7,8}"))) return false
        if (tmdbId != null && tmdbId !in 1..MAX_TMDB_ID) return false
        return if (season == null) episode == null else season > 0 && episode != null && episode > 0
    }

    private fun optionalInt(value: JSONObject, name: String): Int? {
        val number = exactLong(value.opt(name)) ?: return null
        return number.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
    }

    private fun exactLong(value: Any?): Long? {
        if (value !is Number) return null
        val double = value.toDouble()
        if (!double.isFinite() || double != value.toLong().toDouble()) return null
        return value.toLong()
    }

    companion object {
        internal const val DEFAULT_ENDPOINT = "https://api.theintrodb.org/v3/media"
        private const val MAX_RESPONSE_BYTES = 64 * 1024
        private const val MAX_VERSIONS = 512
        private const val MAX_TMDB_ID = 10_000_000L
    }
}

/** Reads only the indexed Chapters element, never arbitrary source data beyond the fixed budget. */
internal suspend fun readIndexedChapters(
    context: Context,
    uri: Uri,
    headers: Map<String, String>,
    offset: Long,
    client: OkHttpClient = OkHttpClient(),
): ByteArray? =
    withTimeoutOrNull(2_000) {
        if (offset < 0) return@withTimeoutOrNull null
        val bytes =
            when (uri.scheme) {
                "file" ->
                    withContext(Dispatchers.IO) {
                        runCatching {
                                RandomAccessFile(File(requireNotNull(uri.path)), "r").use { file ->
                                    if (offset >= file.length()) return@use null
                                    file.seek(offset)
                                    readAtMost(file, MAX_CHAPTER_BYTES + MAX_ELEMENT_HEADER)
                                }
                            }
                            .getOrNull()
                    }
                "content" ->
                    withContext(Dispatchers.IO) {
                        runCatching {
                                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use {
                                    descriptor ->
                                    java.io.FileInputStream(descriptor.fileDescriptor).use { input
                                        ->
                                        input.channel.position(descriptor.startOffset + offset)
                                        readAtMost(input, MAX_CHAPTER_BYTES + MAX_ELEMENT_HEADER)
                                    }
                                }
                            }
                            .getOrNull()
                    }
                "https" ->
                    withContext(Dispatchers.IO) {
                        runCatching {
                                val http =
                                    client
                                        .newBuilder()
                                        .followRedirects(false)
                                        .followSslRedirects(false)
                                        .callTimeout(2, TimeUnit.SECONDS)
                                        .build()
                                val end =
                                    Math.addExact(
                                        offset,
                                        (MAX_CHAPTER_BYTES + MAX_ELEMENT_HEADER - 1).toLong(),
                                    )
                                val request = Request.Builder().url(uri.toString())
                                for ((name, value) in headers) request.header(name, value)
                                request.header("Range", "bytes=$offset-$end")
                                val response = http.newCall(request.get().build()).execute()
                                response.use {
                                    if (it.code != 206 || it.body == null) return@use null
                                    val range = it.header("Content-Range") ?: return@use null
                                    val match = CONTENT_RANGE.matchEntire(range) ?: return@use null
                                    val start = match.groupValues[1].toLongOrNull()
                                    val returnedEnd = match.groupValues[2].toLongOrNull()
                                    if (
                                        start != offset ||
                                            returnedEnd == null ||
                                            returnedEnd !in offset..end
                                    )
                                        return@use null
                                    readBounded(
                                        it.body!!.byteStream(),
                                        MAX_CHAPTER_BYTES + MAX_ELEMENT_HEADER,
                                    )
                                }
                            }
                            .getOrNull()
                    }
                else -> null
            } ?: return@withTimeoutOrNull null
        chapterPayload(bytes)
    }

private fun chapterPayload(bytes: ByteArray): ByteArray? {
    if (bytes.size < 5) return null
    var cursor = 0
    val idWidth = vintWidth(bytes[cursor].toInt() and 0xff, 4) ?: return null
    if (cursor + idWidth > bytes.size) return null
    var id = 0L
    repeat(idWidth) { id = (id shl 8) or (bytes[cursor++].toLong() and 0xff) }
    if (id != 0x1043a770L || cursor >= bytes.size) return null
    val sizeWidth = vintWidth(bytes[cursor].toInt() and 0xff, 8) ?: return null
    if (cursor + sizeWidth > bytes.size) return null
    var size = bytes[cursor++].toLong() and ((0x80 ushr (sizeWidth - 1)) - 1).toLong()
    repeat(sizeWidth - 1) { size = size * 256 + (bytes[cursor++].toLong() and 0xff) }
    if (size < 0 || size > 64 * 1024 || size > bytes.size - cursor) return null
    return bytes.copyOfRange(cursor, cursor + size.toInt())
}

private fun vintWidth(first: Int, maximum: Int): Int? {
    var mask = 0x80
    for (width in 1..maximum) {
        if (first and mask != 0) return width
        mask = mask ushr 1
    }
    return null
}

private fun readBounded(input: java.io.InputStream, maximum: Int): ByteArray? {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        if (output.size() + read > maximum) return null
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}

private fun readAtMost(input: java.io.InputStream, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (output.size() < maximum) {
        val read = input.read(buffer, 0, minOf(buffer.size, maximum - output.size()))
        if (read < 0) break
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}

private fun readAtMost(file: RandomAccessFile, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (output.size() < maximum) {
        val read = file.read(buffer, 0, minOf(buffer.size, maximum - output.size()))
        if (read < 0) break
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}

private const val MAX_CHAPTER_BYTES = 64 * 1024
private const val MAX_ELEMENT_HEADER = 12
private val CONTENT_RANGE = Regex("bytes ([0-9]+)-([0-9]+)/(?:[0-9]+|\\*)")
