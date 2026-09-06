@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.tv.material3.Text
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.Storage
import com.stremio.core.models.Player as CorePlayer
import com.stremio.core.types.resource.Stream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaybackShutdownTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    @Test
    fun backWaitsForTheFinalPositionAndTheUnloadSnapshot() = runBlocking {
        withFixture { activity, fixture, source ->
            val exits = AtomicInteger()
            val failures = AtomicInteger()
            onMain {
                activity.setContent {
                    var departed by remember { mutableStateOf(false) }
                    KinoTheme {
                        if (departed) Text("Playback saved")
                        else
                            FullscreenPlayer(
                                source,
                                fixture.media,
                                app.core,
                                onExit = {
                                    exits.incrementAndGet()
                                    departed = true
                                },
                                onFailure = {
                                    failures.incrementAndGet()
                                    departed = true
                                },
                            )
                    }
                }
            }
            var view: PlayerView? = null
            waitUntil("Fullscreen player must decode the fixture") {
                view = findPlayerView(activity.window.decorView)
                view?.player?.playbackState == Player.STATE_READY
            }
            val player = onMain { view!!.player!! }
            onMain {
                player.pause()
                player.seekTo(player.duration * 95 / 100)
                view!!.hideController()
            }
            waitUntil("The nearly completed episode must have its actual next video") {
                player.playbackState == Player.STATE_READY &&
                    Core.getState<CorePlayer>(Field.PLAYER).nextVideo?.id == fixture.secondVideoId
            }
            assertTrue(Core.drainWrites())
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val unloadEntered = CountDownLatch(1)
            val unloadRelease = CountDownLatch(1)
            app.storage.beforeWrite = { key, value ->
                if (key.startsWith("library")) {
                    val state = itemState(value, fixture.seriesId)
                    if (state?.optString("video_id") == fixture.firstVideoId) {
                        entered.countDown()
                        check(release.await(10, TimeUnit.SECONDS))
                    } else if (state?.optString("video_id") == fixture.secondVideoId) {
                        unloadEntered.countDown()
                        check(unloadRelease.await(10, TimeUnit.SECONDS))
                    }
                }
                null
            }
            try {
                // A changed position after the earlier pause makes the final captured write
                // observable.
                onMain {
                    player.seekTo(player.duration * 96 / 100)
                    view!!.hideController()
                }
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                assertTrue("Final library write must start", entered.await(5, TimeUnit.SECONDS))
                delay(300)
                assertEquals(0, exits.get())
                assertNotNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
                assertFalse(onMain { player.isPlaying })
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                release.countDown()
                assertTrue(
                    "Unload must persist the next episode",
                    unloadEntered.await(5, TimeUnit.SECONDS),
                )
                delay(300)
                assertEquals("Exit must also wait for the Unload write", 0, exits.get())
                unloadRelease.countDown()
                waitUntil("Back must leave exactly once after both writes") { exits.get() == 1 }
                assertEquals(0, failures.get())
                assertNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
                val saved =
                    listOf("library_recent", "library").firstNotNullOfOrNull { key ->
                        itemState(
                            (app.storage.get(key) as Storage.Result.Ok).value,
                            fixture.seriesId,
                        )
                    }
                assertNotNull("Continue Watching must be durable", saved)
                assertEquals(fixture.secondVideoId, saved!!.getString("video_id"))
                assertEquals(1, saved.getLong("timeOffset"))
                if (
                    InstrumentationRegistry.getArguments().getString("persistencePhase") ==
                        "prepare"
                )
                    File(context.cacheDir, "shutdown-restart-pid")
                        .writeText(android.os.Process.myPid().toString())
            } finally {
                release.countDown()
                unloadRelease.countDown()
                app.storage.beforeWrite = null
            }
        }
    }

    @Test
    fun aFailedFinalWriteRetriesWithoutUnloadingOrRecapturingTheStoppedPlayer() = runBlocking {
        withFixture { activity, fixture, source ->
            var player: Player? = null
            var shutdown: TvPlaybackShutdown? = null
            onMain {
                player =
                    createTvPlayer(activity, HardwareRenderers(activity)).also {
                        it.setMediaItem(
                            androidx.media3.common.MediaItem.fromUri(source.stream.url!!.url)
                        )
                        it.prepare()
                    }
                shutdown = TvPlaybackShutdown(player!!, app.core)
            }
            try {
                waitUntil("Fixture must be ready") { player!!.playbackState == Player.STATE_READY }
                onMain { player!!.seekTo(player!!.duration / 2) }
                waitUntil("Seek must settle") { player!!.playbackState == Player.STATE_READY }
                app.storage.beforeWrite = { key, _ ->
                    if (key.startsWith("library")) Storage.Result.Err("Fixture write failure")
                    else null
                }
                val saved = withContext(Dispatchers.Main) { shutdown!!.finish() }
                assertFalse(saved)
                assertNotNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
                app.storage.beforeWrite = null
                assertTrue(withContext(Dispatchers.Main) { shutdown!!.finish(retry = true) })
                assertNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
                assertTrue(withContext(Dispatchers.Main) { shutdown!!.finish() })
            } finally {
                app.storage.beforeWrite = null
                Core.drainWrites(retry = true)
                onMain { player?.release() }
            }
        }
    }

    @Test
    fun aReplacementActivityCanRetryTheDisposedPlayersSave() = runBlocking {
        withFixture { activity, fixture, source ->
            onMain {
                activity.setContent {
                    KinoTheme { FullscreenPlayer(source, fixture.media, app.core, {}, {}) }
                }
            }
            waitUntil("Fullscreen player must decode before Activity replacement") {
                findPlayerView(activity.window.decorView)?.player?.playbackState ==
                    Player.STATE_READY
            }
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            app.storage.beforeWrite = { key, _ ->
                if (key.startsWith("library")) {
                    entered.countDown()
                    check(release.await(10, TimeUnit.SECONDS))
                    Storage.Result.Err("Fixture write failure")
                } else null
            }
            var replacement: PlaybackProbeActivity? = null
            try {
                onMain {
                    val player = findPlayerView(activity.window.decorView)!!.player!!
                    player.seekTo(player.duration / 2)
                    activity.finish()
                }
                assertTrue(entered.await(5, TimeUnit.SECONDS))
                waitUntil("The process must retain the destroyed Activity's save") {
                    app.core.pendingPlaybackSave.status.value == TvPendingPlaybackSave.Status.Saving
                }
                replacement =
                    instrumentation.startActivitySync(
                        Intent(context, PlaybackProbeActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ) as PlaybackProbeActivity
                onMain {
                    replacement.setContent { KinoTheme { PendingPlaybackSaveDialog(app.core) } }
                }
                release.countDown()
                waitUntil("A failed retained save must remain retryable") {
                    app.core.pendingPlaybackSave.status.value == TvPendingPlaybackSave.Status.Failed
                }
                assertNotNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
                onMain {
                    assertFalse(
                        "New playback waits for the retained save",
                        app.core.startPlayer(
                            app.core.state.value.details.sources.first { it.playable }
                        ),
                    )
                }
                app.storage.beforeWrite = null
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
                waitUntil("The replacement Activity's Retry button must finish saving") {
                    app.core.pendingPlaybackSave.status.value == TvPendingPlaybackSave.Status.Idle
                }
                assertNull(Core.getState<CorePlayer>(Field.PLAYER).selected)
            } finally {
                release.countDown()
                app.storage.beforeWrite = null
                onMain {
                    app.core.pendingPlaybackSave.retry()
                    replacement?.finish()
                }
            }
        }
    }

    @Test
    fun savedEpisodeSurvivesProcessRestart() = runBlocking {
        org.junit.Assume.assumeTrue(
            InstrumentationRegistry.getArguments().getString("persistencePhase") == "verify"
        )
        val pidFile = File(context.cacheDir, "shutdown-restart-pid")
        try {
            assertNotEquals(
                "Verification must run in a fresh process",
                pidFile.readText().toInt(),
                android.os.Process.myPid(),
            )
            onMain { app.core.initialize() }
            waitUntil("Core must restore the saved next episode from durable storage") {
                app.core.state.value.continueWatching.any {
                    it.id == "kino-fixture-series" && it.videoId == "kino-fixture-series-1-2"
                }
            }
            val saved =
                itemState(
                    (app.storage.get("library_recent") as Storage.Result.Ok).value,
                    "kino-fixture-series",
                )
            assertEquals(1, saved!!.getLong("timeOffset"))
        } finally {
            pidFile.delete()
        }
    }

    private suspend fun withFixture(
        block: suspend (PlaybackProbeActivity, CoreEpisodeFixture, Source) -> Unit
    ) {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val file = File(context.cacheDir, "shutdown-fixture.mp4")
        instrumentation.context.assets.open("h264-sdr-aac.mp4").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val fixture = CoreEpisodeFixture(activity)
        try {
            onMain {
                fixture.install()
                app.core.open(fixture.media, fixture.firstVideoId)
            }
            waitUntil("Synthetic metadata and playable sources must reach Core") {
                app.core.state.value.details.meta?.id == fixture.seriesId &&
                    app.core.state.value.details.sources.any { it.playable }
            }
            val selected = app.core.state.value.details.sources.first { it.playable }
            onMain { assertTrue(app.core.startPlayer(selected)) }
            waitUntil("Core must establish the current and next episode") {
                val state = Core.getState<CorePlayer>(Field.PLAYER)
                state.selected?.streamRequest?.path?.id == fixture.firstVideoId &&
                    state.libraryItem != null &&
                    state.nextVideo?.id == fixture.secondVideoId
            }
            // Only this internal call substitutes a packaged legal file. User source selection
            // still requires HTTPS.
            val local =
                selected.copy(
                    stream =
                        selected.stream.copy(
                            source = Stream.Source.Url(Stream.Url(Uri.fromFile(file).toString()))
                        )
                )
            assertFalse(local.playable)
            block(activity, fixture, local)
        } finally {
            app.storage.beforeWrite = null
            onMain {
                activity.setContent {}
                app.core.stopPlayer()
                if (
                    InstrumentationRegistry.getArguments().getString("persistencePhase") !=
                        "prepare"
                )
                    fixture.uninstall()
            }
            assertTrue(Core.drainWrites(retry = true))
            fixture.close()
            onMain { activity.finish() }
            file.delete()
        }
    }

    private fun itemState(value: String?, id: String): JSONObject? {
        if (value == null) return null
        fun find(node: JSONObject): JSONObject? {
            if (node.optString("_id") == id) return node.optJSONObject("state")
            for (key in node.keys()) {
                val child = node.optJSONObject(key) ?: continue
                find(child)?.let {
                    return it
                }
            }
            return null
        }
        return find(JSONObject(value))
    }

    private fun findPlayerView(view: View): PlayerView? {
        if (view is PlayerView) return view
        if (view is ViewGroup)
            for (index in 0 until view.childCount) {
                findPlayerView(view.getChildAt(index))?.let {
                    return it
                }
            }
        return null
    }

    private fun <T> onMain(read: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = read() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun waitUntil(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (onMain(condition)) return
            Thread.sleep(100)
        }
        fail(reason)
    }
}
