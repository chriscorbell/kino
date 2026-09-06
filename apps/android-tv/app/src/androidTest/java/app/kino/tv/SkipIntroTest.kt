@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.types.resource.Stream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

class SkipIntroTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    @Test
    fun manualSkipUsesTheEmbeddedMarkerAndTracksSeeking() = runBlocking {
        withPlayback("intro-label.mkv", automatic = false) { activity, player ->
            onMain {
                player.seekTo(6_000)
                player.pause()
                find<PlayerView>(activity.window.decorView)?.showController()
            }
            waitFor("The embedded intro must appear on the timeline and as an action") {
                introBar(activity)?.introMarker() ==
                    TvIntroMarker(5_000, 12_000, TvIntroMarker.Source.Embedded) &&
                    skipButton(activity)?.isShown == true
            }
            waitFor("Playback controls must be ready for remote navigation") {
                find<PlayerView>(activity.window.decorView)?.let {
                    it.isControllerFullyVisible && it.hasFocus()
                } == true
            }
            key(KeyEvent.KEYCODE_DPAD_UP)
            waitFor("Skip Intro must receive remote focus") {
                skipButton(activity)?.hasFocus() == true
            }
            if (InstrumentationRegistry.getArguments().getString("skipIntroScreenshot") == "true") {
                android.util.Log.i("KinoGate", "Skip Intro capture ready")
                delay(10_000)
            }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Manual Skip Intro must seek to the marker end") {
                player.currentPosition in 11_900L..12_500L && skipButton(activity) == null
            }
            assertNull(find<Button>(activity.window.decorView) { it.isShown && it.text == "Undo" })
            onMain { player.seekTo(6_000) }
            waitFor("Seeking back into the intro must restore the button") {
                skipButton(activity)?.isShown == true
            }
            onMain { player.seekTo(13_000) }
            waitFor("Seeking beyond the intro must remove the button") {
                skipButton(activity) == null
            }
        }
    }

    @Test
    fun automaticSkipOffersUndoOnceAndUndoSuppressesTheSegment() = runBlocking {
        withPlayback("intro-type.mkv", automatic = true) { activity, player ->
            onMain {
                player.pause()
                player.seekTo(6_000)
            }
            waitFor("Automatic intro skipping must seek to the typed marker end") {
                player.currentPosition in 11_900L..12_500L &&
                    undoButton(activity)?.hasFocus() == true
            }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Undo must return to the intro start") {
                player.currentPosition in 4_900L..5_500L && undoButton(activity) == null
            }
            delay(500)
            onMain {
                assertTrue(
                    "Undo must suppress another automatic skip",
                    player.currentPosition < 6_000,
                )
                assertNotNull("The manual action must remain available", skipButton(activity))
            }
            onMain { player.seekTo(13_000) }
            waitFor("Leaving the typed marker must hide the action") {
                skipButton(activity) == null
            }
        }
    }

    @Test
    fun embeddedResolutionFailsClosedForUntrustedChapterLayouts() = runBlocking {
        val expected =
            mapOf(
                "intro-label-tail.mkv" to true,
                "intro-type-zero.mkv" to false,
                "intro-no-opening.mkv" to false,
                "intro-no-chapters.mkv" to false,
                "intro-unindexed-tail.mkv" to true,
                "intro-conflicting.mkv" to false,
                "intro-malformed-title.mkv" to false,
                "intro-oversized-tail.mkv" to false,
            )
        for ((asset, available) in expected) {
            withPlayback(asset, automatic = false) { activity, player ->
                onMain {
                    player.pause()
                    player.seekTo(6_000)
                }
                if (available) {
                    waitFor("$asset must resolve its indexed intro") {
                        skipButton(activity)?.isShown == true
                    }
                } else {
                    delay(500)
                    assertNull("$asset must not expose Skip Intro", skipButton(activity))
                    assertNull(introBar(activity)?.introMarker())
                }
            }
        }
    }

    @Test
    fun communityLookupRequiresOneExactRuntimeAndMatchingIdentity() = runBlocking {
        val duration = 3_501_000L
        IntroServer(
                listOf(
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":0},{"duration_ms":$duration}]}""",
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"intro":[{"start_ms":10000,"end_ms":22000}]}""",
                )
            )
            .use { server ->
                val marker =
                    IntroCommunityClient(server.endpoint)
                        .lookup(IntroIdentity(duration, tmdbId = 1396, season = 1, episode = 1))
                assertEquals(
                    "requests=${server.requests.get()} paths=${server.paths}",
                    TvIntroMarker(10_000, 22_000, TvIntroMarker.Source.Community),
                    marker,
                )
                assertEquals(2, server.requests.get())
                assertTrue(server.paths[0].contains("list_versions=true"))
                assertTrue(server.paths[1].contains("merge_unknown=false"))
                assertFalse(server.headers.joinToString("\n").contains("Authorization", true))
                assertFalse(server.headers.joinToString("\n").contains("Cookie", true))
            }
        IntroServer(
                listOf(
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":${duration + 1}}]}"""
                )
            )
            .use { server ->
                assertNull(
                    IntroCommunityClient(server.endpoint)
                        .lookup(IntroIdentity(duration, tmdbId = 1396, season = 1, episode = 1))
                )
                assertEquals(
                    "An unmatched runtime must not request fallback markers",
                    1,
                    server.requests.get(),
                )
            }
    }

    @Test
    fun communityFailuresStayBoundedAndFailClosed() = runBlocking {
        val duration = 3_501_000L
        for (identity in listOf("", "\"tmdb_id\":null,", "\"tmdb_id\":0,")) {
            IntroServer(
                    listOf(
                        """{$identity"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":$duration}]}"""
                    )
                )
                .use { server ->
                    assertNull(
                        IntroCommunityClient(server.endpoint)
                            .lookup(
                                IntroIdentity(
                                    duration,
                                    imdbId = "tt0903747",
                                    season = 1,
                                    episode = 1,
                                )
                            )
                    )
                    assertEquals(1, server.requests.get())
                }
        }
        for (intro in
            listOf(
                """[{"end_ms":22000}]""",
                """[{"start_ms":10000,"end_ms":22000},{"end_ms":32000}]""",
            )) {
            IntroServer(
                    listOf(
                        """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":$duration}]}""",
                        """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"intro":$intro}""",
                    )
                )
                .use { server ->
                    assertNull(
                        IntroCommunityClient(server.endpoint)
                            .lookup(IntroIdentity(duration, tmdbId = 1396, season = 1, episode = 1))
                    )
                    assertEquals(2, server.requests.get())
                }
        }
        IntroServer(
                listOf(
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":$duration}]}"""
                ),
                contentLengthExtra = listOf(10),
            )
            .use { server ->
                assertNull(
                    IntroCommunityClient(server.endpoint)
                        .lookup(IntroIdentity(duration, tmdbId = 1396, season = 1, episode = 1))
                )
            }
        IntroServer(
                listOf(
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":$duration}]}""",
                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"intro":[{"start_ms":10000,"end_ms":22000}]}""",
                ),
                bodyDelaysMs = listOf(3_000, 4_000),
                allowDisconnects = true,
            )
            .use { server ->
                val started = System.nanoTime()
                assertNull(
                    IntroCommunityClient(server.endpoint)
                        .lookup(IntroIdentity(duration, tmdbId = 1396, season = 1, episode = 1))
                )
                val elapsed = (System.nanoTime() - started) / 1_000_000
                assertTrue("The shared deadline took ${elapsed}ms", elapsed < 6_500)
            }
        assertNull(
            readIndexedChapters(context, Uri.parse("https://127.0.0.1:1/video.mkv"), emptyMap(), 0)
        )
    }

    @Test
    fun hlsPlaybackUsesTheCommunityMarker() = runBlocking {
        AdaptiveIntroServer().use { server ->
            withPlaybackUrl(
                server.playlist,
                automatic = false,
                mediaId = "tmdb:1396",
                introEndpoint = server.endpoint,
            ) { activity, player ->
                onMain {
                    player.pause()
                    player.seekTo(6_000)
                }
                waitFor("HLS must expose its trusted community marker") {
                    introBar(activity)?.introMarker()?.source == TvIntroMarker.Source.Community &&
                        skipButton(activity)?.isShown == true
                }
                onMain { find<PlayerView>(activity.window.decorView)?.showController() }
                waitFor("HLS playback controls must accept remote focus") {
                    find<PlayerView>(activity.window.decorView)?.let {
                        it.isControllerFullyVisible && it.hasFocus()
                    } == true
                }
                key(KeyEvent.KEYCODE_DPAD_UP)
                waitFor("HLS Skip Intro must receive remote focus") {
                    skipButton(activity)?.hasFocus() == true
                }
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("HLS Skip Intro must seek to the community marker end") {
                    player.currentPosition in 11_900L..12_500L
                }
                assertEquals("paths=${server.paths}", 2, server.communityRequests.get())
            }
        }
    }

    private suspend fun withPlayback(
        asset: String,
        automatic: Boolean,
        block: suspend (PlaybackProbeActivity, Player) -> Unit,
    ) {
        val file = File(context.cacheDir, asset)
        instrumentation.context.assets.open(asset).use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        try {
            withPlaybackUrl(Uri.fromFile(file).toString(), automatic, block = block)
        } finally {
            file.delete()
        }
    }

    private suspend fun withPlaybackUrl(
        url: String,
        automatic: Boolean,
        mediaId: String? = null,
        introEndpoint: String = IntroCommunityClient.DEFAULT_ENDPOINT,
        block: suspend (PlaybackProbeActivity, Player) -> Unit,
    ) {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        app.settings
            .edit()
            .putBoolean("skip_intro", true)
            .putBoolean("automatic_intro", automatic)
            .commit()
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val fixture = CoreEpisodeFixture(activity)
        try {
            onMain {
                fixture.install()
                app.core.open(fixture.media, fixture.firstVideoId)
            }
            waitFor("Core must resolve the intro fixture source") {
                app.core.state.value.details.sources.any { it.playable }
            }
            val selected = app.core.state.value.details.sources.first { it.playable }
            val source =
                selected.copy(
                    stream = selected.stream.copy(source = Stream.Source.Url(Stream.Url(url)))
                )
            val playbackMedia =
                mediaId?.let { Media(it, "series", "Kino fixture", null) } ?: fixture.media
            onMain {
                assertTrue(app.core.startPlayer(selected))
                activity.setContent {
                    val state by app.core.state.collectAsState()
                    KinoTheme {
                        FullscreenPlayer(
                            source,
                            playbackMedia,
                            app.core,
                            onExit = {},
                            onFailure = { fail("Fixture playback failed: $it") },
                            onUpNext = {},
                            introEndpoint = introEndpoint,
                        )
                    }
                }
            }
            var player: Player? = null
            waitFor("The Shield must decode the intro fixture") {
                player = find<PlayerView>(activity.window.decorView)?.player
                player?.playbackState == Player.STATE_READY
            }
            block(activity, player!!)
        } finally {
            onMain { activity.setContent {} }
            try {
                assertTrue(Core.drainWrites(retry = true))
            } finally {
                onMain {
                    app.core.stopPlayer()
                    fixture.uninstall()
                    activity.finish()
                }
                Core.drainWrites(retry = true)
                fixture.close()
                app.settings.edit().remove("skip_intro").remove("automatic_intro").commit()
            }
        }
    }

    private class IntroServer(
        private val bodies: List<String>,
        private val bodyDelaysMs: List<Long> = emptyList(),
        private val contentLengthExtra: List<Int> = emptyList(),
        private val allowDisconnects: Boolean = false,
    ) : AutoCloseable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val failure = AtomicReference<Throwable>()
        val requests = AtomicInteger()
        val paths = mutableListOf<String>()
        val headers = mutableListOf<String>()
        val endpoint = "http://127.0.0.1:${server.localPort}/v3/media"
        private val thread =
            Thread {
                    try {
                        for ((index, body) in bodies.withIndex()) {
                            server.accept().use { socket ->
                                val reader = socket.getInputStream().bufferedReader()
                                paths += reader.readLine().split(' ')[1]
                                val requestHeaders = mutableListOf<String>()
                                while (true) {
                                    val line = reader.readLine()
                                    if (line.isNullOrEmpty()) break
                                    requestHeaders += line
                                }
                                headers += requestHeaders
                                requests.incrementAndGet()
                                val bytes = body.toByteArray()
                                socket.getOutputStream().apply {
                                    write(
                                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size + contentLengthExtra.getOrElse(index) { 0 }}\r\nConnection: close\r\n\r\n"
                                            .toByteArray()
                                    )
                                    flush()
                                    Thread.sleep(bodyDelaysMs.getOrElse(index) { 0 })
                                    write(bytes)
                                    flush()
                                }
                            }
                        }
                    } catch (error: Throwable) {
                        if (!(error is SocketException && (server.isClosed || allowDisconnects)))
                            failure.set(error)
                    }
                }
                .apply { start() }

        override fun close() {
            server.close()
            thread.join(6_000)
            check(!thread.isAlive)
            failure.get()?.let { throw AssertionError("Intro fixture server failed", it) }
        }
    }

    private inner class AdaptiveIntroServer : AutoCloseable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val failure = AtomicReference<Throwable>()
        private val playlistBytes =
            instrumentation.context.assets.open("intro-hls.m3u8").readBytes()
        private val segmentName =
            playlistBytes.decodeToString().lineSequence().first {
                !it.startsWith("#") && it.isNotBlank()
            }
        private val segmentBytes = instrumentation.context.assets.open(segmentName).readBytes()
        val communityRequests = AtomicInteger()
        val paths = mutableListOf<String>()
        val playlist = "http://127.0.0.1:${server.localPort}/intro.m3u8"
        val endpoint = "http://127.0.0.1:${server.localPort}/v3/media"
        private val thread =
            Thread {
                    try {
                        while (!server.isClosed) {
                            server.accept().use { socket ->
                                socket.soTimeout = 5_000
                                val reader = socket.getInputStream().bufferedReader()
                                val path = reader.readLine().split(' ')[1]
                                paths += path
                                while (!reader.readLine().isNullOrEmpty()) {}
                                val route = path.substringBefore('?')
                                val (contentType, body) =
                                    when (route) {
                                        "/intro.m3u8" ->
                                            "application/vnd.apple.mpegurl" to playlistBytes
                                        "/$segmentName" -> "video/mp2t" to segmentBytes
                                        "/v3/media" -> {
                                            communityRequests.incrementAndGet()
                                            val query = Uri.parse("http://fixture$path")
                                            val duration =
                                                query
                                                    .getQueryParameter("duration_ms")
                                                    ?.toLongOrNull() ?: error("Missing duration")
                                            val json =
                                                if (
                                                    query.getQueryParameter("list_versions") ==
                                                        "true"
                                                ) {
                                                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"versions":[{"duration_ms":$duration}]}"""
                                                } else {
                                                    """{"tmdb_id":1396,"type":"tv","season":1,"episode":1,"intro":[{"start_ms":5000,"end_ms":12000}]}"""
                                                }
                                            "application/json" to json.toByteArray()
                                        }
                                        else -> error("Unexpected adaptive fixture request: $path")
                                    }
                                socket.getOutputStream().apply {
                                    write(
                                        "HTTP/1.1 200 OK\r\nContent-Type: $contentType\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                                            .toByteArray()
                                    )
                                    write(body)
                                    flush()
                                }
                            }
                        }
                    } catch (error: Throwable) {
                        if (!(error is SocketException && server.isClosed)) failure.set(error)
                    }
                }
                .apply { start() }

        override fun close() {
            server.close()
            thread.join(6_000)
            check(!thread.isAlive)
            failure.get()?.let { throw AssertionError("Adaptive intro fixture server failed", it) }
        }
    }

    private fun introBar(activity: PlaybackProbeActivity) =
        find<TvIntroTimeBar>(activity.window.decorView)

    private fun skipButton(activity: PlaybackProbeActivity) =
        find<Button>(activity.window.decorView) {
            it.isShown && it.text == context.getString(R.string.skip_intro)
        }

    private fun undoButton(activity: PlaybackProbeActivity) =
        find<Button>(activity.window.decorView) {
            it.isShown && it.text == context.getString(R.string.undo)
        }

    private inline fun <reified T : View> find(
        view: View,
        predicate: (T) -> Boolean = { true },
    ): T? = views(view).filterIsInstance<T>().firstOrNull(predicate)

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup)
            for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }

    private fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
    }

    private suspend fun waitFor(label: String, condition: suspend () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            if (withContext(Dispatchers.Main) { condition() }) return
            delay(50)
        }
        fail(label)
    }

    private suspend fun <T> onMain(block: () -> T): T = withContext(Dispatchers.Main) { block() }
}
