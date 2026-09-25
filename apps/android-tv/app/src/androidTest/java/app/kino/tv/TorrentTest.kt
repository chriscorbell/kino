package app.kino.tv

import android.content.Intent
import android.view.SurfaceView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.types.resource.Stream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The torrent engine on the Shield, end to end without a swarm: a private torrent whose only
 * source is a web seed this test serves on loopback, opened by the engine Kino ships, read back
 * byte for byte, and played by Media3 through the same loopback address a torrent source gets.
 */
class TorrentTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app = context.applicationContext as KinoApplication
    private val client = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build()
    private var seed: ServerSocket? = null

    @After
    fun stop() {
        seed?.close()
        runBlocking { app.engine.clearCache() }
    }

    private fun media(): ByteArray =
        instrumentation.context.assets.open("h264-sdr-aac.mp4").use { it.readBytes() }

    /** An HTTP/1.1 range server for [bytes], one request per connection. */
    private fun serve(bytes: ByteArray): Int {
        val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        seed = server
        thread(isDaemon = true, name = "web-seed") {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    socket.use {
                        val input = it.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                        val request = input.readLine() ?: return@thread
                        var range: LongRange? = null
                        while (true) {
                            val line = input.readLine() ?: break
                            if (line.isEmpty()) break
                            Regex("(?i)^range: bytes=(\\d+)-(\\d*)$").matchEntire(line)?.let { m ->
                                val start = m.groupValues[1].toLong()
                                val end =
                                    m.groupValues[2].toLongOrNull()?.coerceAtMost(bytes.size - 1L)
                                        ?: (bytes.size - 1L)
                                range = start..end
                            }
                        }
                        val span = range ?: 0L..(bytes.size - 1L)
                        val head =
                            buildString {
                                append(if (range != null) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                                append("Content-Length: ${span.last - span.first + 1}\r\n")
                                append("Accept-Ranges: bytes\r\n")
                                if (range != null)
                                    append("Content-Range: bytes ${span.first}-${span.last}/${bytes.size}\r\n")
                                append("Connection: close\r\n\r\n")
                            }
                        val out = it.getOutputStream()
                        out.write(head.toByteArray(Charsets.ISO_8859_1))
                        if (!request.startsWith("HEAD"))
                            out.write(bytes, span.first.toInt(), (span.last - span.first + 1).toInt())
                        out.flush()
                    }
                }
            }
        }
        return server.localPort
    }

    private fun bencode(value: Any): ByteArray {
        val out = ByteArrayOutputStream()
        fun write(item: Any) {
            when (item) {
                is ByteArray -> {
                    out.write("${item.size}:".toByteArray())
                    out.write(item)
                }
                is String -> write(item.toByteArray())
                is Int -> out.write("i${item}e".toByteArray())
                is Map<*, *> -> {
                    out.write('d'.code)
                    item.keys.map { it as String }.sorted().forEach { key ->
                        write(key)
                        write(item[key]!!)
                    }
                    out.write('e'.code)
                }
                else -> error("Cannot bencode $item")
            }
        }
        write(value)
        return out.toByteArray()
    }

    /** A private single-file torrent whose only source is the web seed at [port]. */
    private fun torrent(bytes: ByteArray, port: Int): Pair<String, ByteArray> {
        val pieceLength = 262_144
        val pieces = ByteArrayOutputStream()
        for (offset in bytes.indices step pieceLength)
            pieces.write(
                MessageDigest.getInstance("SHA-1")
                    .digest(bytes.copyOfRange(offset, minOf(offset + pieceLength, bytes.size)))
            )
        val info =
            mapOf(
                "length" to bytes.size,
                "name" to "fixture.mp4",
                "piece length" to pieceLength,
                "pieces" to pieces.toByteArray(),
                "private" to 1,
            )
        val hash =
            MessageDigest.getInstance("SHA-1").digest(bencode(info)).joinToString("") {
                "%02x".format(it)
            }
        return hash to bencode(mapOf("info" to info, "url-list" to "http://127.0.0.1:$port/fixture.mp4"))
    }

    /**
     * Reads [url] to the end the way a player does: a read the engine ends early, while it is still
     * fetching pieces, resumes from where it stopped with a range request.
     */
    private fun readAll(url: String, size: Int): ByteArray {
        val out = ByteArrayOutputStream()
        repeat(20) {
            if (out.size() >= size) return out.toByteArray()
            val request =
                Request.Builder()
                    .url(url)
                    .apply { if (out.size() > 0) header("Range", "bytes=${out.size()}-") }
                    .build()
            runCatching {
                client.newCall(request).execute().use { response ->
                    assertTrue(response.code == 200 || response.code == 206)
                    checkNotNull(response.body).byteStream().use { input ->
                        val buffer = ByteArray(65_536)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                        }
                    }
                }
            }
        }
        return out.toByteArray()
    }

    private fun open(bytes: ByteArray): Pair<String, String> {
        val (hash, torrent) = torrent(bytes, serve(bytes))
        val base = runBlocking { app.engine.url() }
        val created =
            client
                .newCall(
                    Request.Builder()
                        .url("$base/create")
                        .post(
                            JSONObject()
                                .put("torrent", torrent.joinToString("") { "%02x".format(it) })
                                .toString()
                                .toRequestBody("application/json".toMediaType())
                        )
                        .build()
                )
                .execute()
                .use { JSONObject(checkNotNull(it.body).string()) }
        assertEquals("The engine opens the supplied torrent", hash, created.getString("infoHash"))
        return base to hash
    }

    @Test
    fun theEngineStreamsATorrentByteForByte() {
        val bytes = media()
        val (base, hash) = open(bytes)
        assertTrue(Regex("^http://127\\.0\\.0\\.1:\\d+/kino/[0-9a-f]{64}$").matches(base))
        // What Kino plays for a torrent source: the file Core names, opened through the engine.
        val url = runBlocking {
            app.engine.mediaUrl(Stream.Tramvai(infoHash = hash, fileIdx = 0))
        }
        assertEquals("$base/$hash/0", url)
        assertArrayEquals(bytes, readAll(url, bytes.size))
        client
            .newCall(Request.Builder().url(url).header("Range", "bytes=100000-100999").build())
            .execute()
            .use {
                assertEquals(206, it.code)
                assertArrayEquals(bytes.copyOfRange(100_000, 101_000), checkNotNull(it.body).bytes())
            }
        // The address alone is not enough: the per-start secret is part of the path.
        val origin = base.substringBefore("/kino/")
        client.newCall(Request.Builder().url("$origin/$hash/0").build()).execute().use {
            assertEquals(401, it.code)
        }
    }

    @Test
    fun media3PlaysATorrentThroughTheLoopbackEngine() {
        val (base, hash) = open(media())
        val url = "$base/$hash/0"
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val playing = CountDownLatch(1)
        var player: ExoPlayer? = null
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                player =
                    ExoPlayer.Builder(activity, HardwareRenderers(activity)).build().apply {
                        setVideoSurfaceView(surface)
                        addListener(
                            object : Player.Listener {
                                override fun onIsPlayingChanged(isPlaying: Boolean) {
                                    if (isPlaying) playing.countDown()
                                }
                            }
                        )
                        setMediaItem(MediaItem.fromUri(url))
                        prepare()
                        playWhenReady = true
                    }
            }
            assertTrue("Media3 plays the torrent's file", playing.await(30, TimeUnit.SECONDS))
            var position = 0L
            val deadline = System.currentTimeMillis() + 10_000
            while (position < 500 && System.currentTimeMillis() < deadline) {
                Thread.sleep(100)
                instrumentation.runOnMainSync { position = player!!.currentPosition }
            }
            assertTrue("Playback advances past half a second: $position", position >= 500)
        } finally {
            instrumentation.runOnMainSync {
                player?.release()
                activity.finish()
            }
        }
    }

    @Test
    fun clearingTheCacheStopsTheEngineAndDeletesItsDownloads() = runBlocking {
        val bytes = media()
        val (first, hash) = open(bytes)
        assertArrayEquals(bytes, readAll("$first/$hash/0", bytes.size))
        assertTrue("The torrent is on disk", engineCacheSize(context) > 0)
        assertTrue(app.engine.clearCache())
        assertEquals(0L, engineCacheSize(context))
        assertFalse(app.engine.cacheDirectory.exists())
        // A new start is a new capability.
        assertNotEquals(first, app.engine.url())
    }

    private fun torrentStream(infoHash: String) =
        Stream(
            source = Stream.Source.Tramvai(Stream.Tramvai(infoHash = infoHash)),
            behaviorHints = com.stremio.core.types.resource.StreamBehaviorHints(notWebReady = false),
            deepLinks =
                com.stremio.core.types.resource.StreamDeepLinks(
                    player = "",
                    externalPlayer = com.stremio.core.types.resource.StreamDeepLinks.ExternalPlayerLink(),
                ),
        )

    @Test
    fun torrentsArePlayableAndPlainHttpStaysRefused() {
        val torrent =
            Source(
                "fixture",
                torrentStream("a".repeat(40)),
                com.stremio.core.types.addon.ResourceRequest(
                    "https://example.invalid/manifest.json",
                    com.stremio.core.types.addon.ResourcePath("stream", "movie", "tt1"),
                ),
            )
        assertTrue(torrent.playable)
        assertNull(
            "A malformed info hash is not a torrent",
            torrent.copy(stream = torrentStream("nope")).torrent,
        )
        // Only the engine's loopback address may use plain HTTP.
        val refused =
            runCatching {
                    client.newCall(Request.Builder().url("http://example.invalid/").build()).execute()
                }
                .exceptionOrNull()
        assertTrue("Cleartext elsewhere is refused: $refused", refused is java.net.UnknownServiceException)
        assertTrue(
            "Android extracted the engine executable",
            File(context.applicationInfo.nativeLibraryDir, "libkino_stream_engine.so").canExecute(),
        )
    }
}
