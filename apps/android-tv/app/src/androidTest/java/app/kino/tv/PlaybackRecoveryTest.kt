package app.kino.tv

import android.content.Intent
import android.view.SurfaceView
import androidx.activity.compose.setContent
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.resource.MetaItem
import com.stremio.core.types.resource.MetaItemBehaviorHints
import com.stremio.core.types.resource.MetaItemDeepLinks
import com.stremio.core.types.resource.PosterShape
import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.StreamBehaviorHints
import com.stremio.core.types.resource.StreamDeepLinks
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the TV player does when a source misbehaves, through the production player against a
 * loopback server that refuses, goes missing, fails for a while, drops the connection mid-file, or
 * serves something that is not video.
 */
class PlaybackRecoveryTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private var server: ServerSocket? = null
    private val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())

    @After
    fun close() {
        server?.close()
    }

    private fun media(): ByteArray =
        instrumentation.context.assets.open("h264-sdr-aac.mp4").use { it.readBytes() }

    /**
     * Serves [bytes] with ranges. [respond] may answer a request itself, by its index and range
     * start, with a status and no body, or return a byte count after which to drop the connection.
     */
    private fun serve(bytes: ByteArray, respond: (index: Int, start: Long) -> Pair<Int?, Int?>): String {
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = socket
        val count = AtomicInteger()
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val connection = runCatching { socket.accept() }.getOrNull() ?: break
                thread(isDaemon = true) {
                    connection.use { client ->
                        val input = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                        val request = input.readLine() ?: return@thread
                        var start = 0L
                        var ranged = false
                        while (true) {
                            val line = input.readLine() ?: break
                            if (line.isEmpty()) break
                            Regex("(?i)^range: bytes=(\\d+)-").find(line)?.let {
                                start = it.groupValues[1].toLong()
                                ranged = true
                            }
                        }
                        requests += "$request ${if (ranged) "from $start" else ""}".trim()
                        val (status, dropAfter) = respond(count.getAndIncrement(), start)
                        val out = client.getOutputStream()
                        if (status != null) {
                            out.write("HTTP/1.1 $status Status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                            return@thread
                        }
                        val length = bytes.size - start
                        out.write(
                            buildString {
                                    append(if (ranged) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                                    append("Content-Type: video/mp4\r\n")
                                    append("Content-Length: $length\r\n")
                                    append("Accept-Ranges: bytes\r\n")
                                    if (ranged) append("Content-Range: bytes $start-${bytes.size - 1}/${bytes.size}\r\n")
                                    append("Connection: close\r\n\r\n")
                                }
                                .toByteArray()
                        )
                        val sent = minOf(length, dropAfter?.toLong() ?: length).toInt()
                        out.write(bytes, start.toInt(), sent)
                        out.flush()
                    }
                }
            }
        }
        return "http://127.0.0.1:${socket.localPort}/fixture.mp4"
    }

    private sealed interface Result {
        data class Played(val position: Long) : Result

        data class Failed(val reason: Int) : Result
    }

    /** Plays [url] in Kino's player until it passes a second or fails. */
    private fun play(url: String, timeoutMs: Long = 45_000): Result {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        var failure: PlaybackException? = null
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                player =
                    createTvPlayer(activity, HardwareRenderers(activity)).apply {
                        setVideoSurfaceView(surface)
                        addListener(
                            object : Player.Listener {
                                override fun onPlayerError(error: PlaybackException) {
                                    failure = error
                                }
                            }
                        )
                        setMediaItem(MediaItem.fromUri(url))
                        prepare()
                        playWhenReady = true
                    }
            }
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                Thread.sleep(100)
                var position = 0L
                instrumentation.runOnMainSync { position = player!!.currentPosition }
                failure?.let {
                    return Result.Failed(playbackFailureReason(it, R.string.source_unsupported))
                }
                if (position >= 1_000) return Result.Played(position)
            }
            error("Neither played nor failed; requests: $requests")
        } finally {
            instrumentation.runOnMainSync {
                player?.release()
                activity.finish()
            }
        }
    }

    @Test
    fun aRefusedSourceFailsAtOnceAndSaysWhy() {
        val url = serve(media()) { _, _ -> 403 to null }
        assertEquals(Result.Failed(R.string.playback_refused), play(url))
        assertEquals("A refusal is not retried: $requests", 1, requests.size)
    }

    @Test
    fun aMissingFileSaysItIsGone() {
        val url = serve(media()) { _, _ -> 404 to null }
        assertEquals(Result.Failed(R.string.playback_gone), play(url))
        assertEquals(1, requests.size)
    }

    @Test
    fun aServerThatFailsForAWhileIsRetriedUntilItAnswers() {
        val url = serve(media()) { index, _ -> (if (index < 2) 503 else null) to null }
        assertTrue(play(url) is Result.Played)
        assertTrue("Two failures, then the file: $requests", requests.size >= 3)
    }

    @Test
    fun aDroppedConnectionResumesWhereItStopped() {
        val bytes = media()
        val url = serve(bytes) { index, _ -> null to (if (index == 0) 150_000 else null) }
        assertTrue(play(url) is Result.Played)
        assertTrue(
            "The player asked again from where the stream stopped: $requests",
            requests.drop(1).any { it.contains("from ") && !it.endsWith("from 0") },
        )
    }

    @Test
    fun somethingThatIsNotVideoSaysItIsDamaged() {
        val url = serve(ByteArray(300_000) { (it * 31 % 251).toByte() }) { _, _ -> null to null }
        assertEquals(Result.Failed(R.string.playback_damaged), play(url))
    }

    @Test
    fun theSourceThatFailedIsMarkedOnTheDetailsPage() {
        fun source(name: String, url: String) =
            Source(
                "Fixture provider",
                Stream(
                    source = Stream.Source.Url(Stream.Url(url)),
                    name = name,
                    behaviorHints = StreamBehaviorHints(notWebReady = false),
                    deepLinks =
                        StreamDeepLinks(player = "", externalPlayer = StreamDeepLinks.ExternalPlayerLink()),
                ),
                ResourceRequest("https://addon.invalid/manifest.json", ResourcePath("stream", "movie", "tt1")),
            )
        val sources =
            listOf(source("First fixture source", "https://media.invalid/1.mp4"), source("Second fixture source", "https://media.invalid/2.mp4"))
        val meta =
            MetaItem(
                id = "tt1",
                type = "movie",
                name = "Recovery fixture",
                posterShape = PosterShape.POSTER,
                behaviorHints = MetaItemBehaviorHints(hasScheduledVideos = false),
                deepLinks = MetaItemDeepLinks(),
                inLibrary = false,
                watched = false,
                receiveNotifications = false,
            )
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        try {
            instrumentation.runOnMainSync {
                activity.setContent {
                    KinoTheme {
                        DetailScreen(
                            Media("tt1", "movie", "Recovery fixture", null),
                            "tt1",
                            Details(meta = meta, sources = sources, loading = false, sourcesLoading = false),
                            R.string.playback_gone,
                            false,
                            {},
                            onEpisode = {},
                            onRetry = {},
                            onLibrary = {},
                            onSource = {},
                            failedSource = FailedSource("tt1", sources[0].stream.source),
                        )
                    }
                }
            }
            remote.waitFor(context.getString(R.string.playback_gone))
            remote.waitFor("First fixture source")
            val failed = context.getString(R.string.source_failed)
            val marks = remote.visible().filter { it.text?.toString() == failed }
            assertEquals("Only the failed source is marked", 1, marks.size)
            var row = marks.single()
            while (row.parent != null && !row.isFocusable) row = row.parent
            assertTrue(
                "The mark sits on the source that failed",
                remote.visible().any {
                    it.text?.toString() == "First fixture source" &&
                        generateSequence(it) { node -> node.parent }.any { ancestor -> ancestor == row }
                },
            )
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
