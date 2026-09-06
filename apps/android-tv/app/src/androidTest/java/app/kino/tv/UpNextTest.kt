@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.tv.material3.Text
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.Storage
import com.stremio.core.models.Player as CorePlayer
import com.stremio.core.types.resource.Stream
import com.stremio.core.types.resource.Video
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UpNextTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    @Test
    fun upNextUpdatesTheRetainedSeasonScrollAndEpisodeFocus() = runBlocking {
        for ((nextSeason, firstEpisode) in listOf(2 to 1, 1 to 50)) {
            withFixture("h264-sdr-aac.mp4", nextSeason = nextSeason, firstEpisode = firstEpisode) {
                activity,
                fixture,
                source ->
                var playing by mutableStateOf(false)
                var videoId by mutableStateOf<String?>(fixture.firstVideoId)
                val departures = AtomicInteger()
                onMain {
                    activity.setContent {
                        val saved = rememberSaveableStateHolder()
                        val state by app.core.state.collectAsState()
                        val back = {
                            videoId = null
                            app.core.open(fixture.media, null)
                        }
                        BackHandler(!playing && videoId != null, onBack = back)
                        KinoTheme {
                            if (playing)
                                FullscreenPlayer(
                                    source,
                                    fixture.media,
                                    app.core,
                                    onExit = { playing = false },
                                    onFailure = { departures.addAndGet(1000) },
                                    onUpNext = {
                                        videoId = it.id
                                        app.core.open(fixture.media, it.id)
                                        playing = false
                                        departures.incrementAndGet()
                                    },
                                )
                            else
                                saved.SaveableStateProvider("series") {
                                    DetailScreen(
                                        fixture.media,
                                        videoId,
                                        state.details,
                                        null,
                                        false,
                                        onBack = back,
                                        onEpisode = {},
                                        onRetry = {},
                                        onLibrary = {},
                                        onSource = {},
                                    )
                                }
                        }
                    }
                }
                withTimeout(15_000) { while (!visibleText().contains("First episode")) delay(80) }
                onMain { playing = true }
                val view = ready(activity)
                onMain {
                    view.player!!.seekTo(view.player!!.duration * 95 / 100)
                    view.showController()
                }
                waitFor("The offer and controls must be ready for remote input") {
                    action(activity) != null && view.isControllerFullyVisible && view.hasFocus()
                }
                key(KeyEvent.KEYCODE_DPAD_UP)
                waitFor("Choose source must be focused") { action(activity)?.hasFocus() == true }
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitFor("Up Next must return to the same saved details entry") {
                    departures.get() == 1 &&
                        !playing &&
                        app.core.state.value.details.sources.any {
                            it.request.path.id == fixture.secondVideoId
                        }
                }
                key(KeyEvent.KEYCODE_BACK)
                withTimeout(15_000) { while (!focusedText().contains("Second episode")) delay(80) }
                assertNull(onMain { videoId })
                assertNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
                if (nextSeason == 2) {
                    key(KeyEvent.KEYCODE_DPAD_UP)
                    withTimeout(15_000) { while (!focusedText().contains("Season 2")) delay(80) }
                }
            }
        }
    }

    @Test
    fun choosingTheNextEpisodeWaitsForFinalAndUnloadWritesBeforeShowingItsSources() = runBlocking {
        withFixture("h264-sdr-aac.mp4") { activity, fixture, source ->
            val chosen = AtomicInteger()
            val sourceStarts = AtomicInteger()
            showDestination(activity, fixture, source, chosen, sourceStarts)
            val view = ready(activity)
            val player = onMain { view.player!! }
            onMain { player.seekTo(player.duration * 95 / 100) }
            waitFor("Up Next must be available") { action(activity) != null }
            assertTrue(Core.drainWrites())
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            val unloadEntered = CountDownLatch(1)
            val unloadRelease = CountDownLatch(1)
            app.storage.beforeWrite = write@{ key, value ->
                if (key.startsWith("library")) {
                    when (itemState(value, fixture.seriesId)?.optString("video_id")) {
                        fixture.firstVideoId -> {
                            entered.countDown()
                            if (!release.await(10, TimeUnit.SECONDS))
                                return@write Storage.Result.Err("Final-write gate timed out")
                        }
                        fixture.secondVideoId -> {
                            unloadEntered.countDown()
                            if (!unloadRelease.await(10, TimeUnit.SECONDS))
                                return@write Storage.Result.Err("Unload-write gate timed out")
                        }
                    }
                }
                null
            }
            try {
                onMain {
                    player.seekTo(player.duration * 96 / 100)
                    view.showController()
                }
                waitFor("Playback controls must finish appearing before Up enters the offer") {
                    view.isControllerFullyVisible && view.hasFocus()
                }
                key(KeyEvent.KEYCODE_DPAD_UP)
                waitFor("Choose source must be focused") { action(activity)?.hasFocus() == true }
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                assertTrue("The final library write must start", entered.await(5, TimeUnit.SECONDS))
                delay(200)
                assertEquals(0, chosen.get())
                assertFalse(onMain { player.isPlaying })
                assertNotNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                release.countDown()
                assertTrue(
                    "Unload must persist the next episode",
                    unloadEntered.await(5, TimeUnit.SECONDS),
                )
                delay(200)
                assertEquals(0, chosen.get())
                unloadRelease.countDown()
                waitFor("Exactly one next-episode source list must open after both saves") {
                    chosen.get() == 1 &&
                        app.core.state.value.details.sources.any {
                            it.request.path.id == fixture.secondVideoId
                        }
                }
                assertNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
                assertEquals("The source list must not select a stream", 0, sourceStarts.get())
                val saved =
                    listOf("library_recent", "library").firstNotNullOfOrNull {
                        itemState(
                            (app.storage.get(it) as Storage.Result.Ok).value,
                            fixture.seriesId,
                        )
                    }
                assertEquals(fixture.secondVideoId, saved?.getString("video_id"))
            } finally {
                release.countDown()
                unloadRelease.countDown()
                app.storage.beforeWrite = null
            }
        }
    }

    @Test
    fun failedSaveRetriesTheChosenDestinationWithoutStartingAStream() = runBlocking {
        withFixture("h264-sdr-aac.mp4") { activity, fixture, source ->
            val chosen = AtomicInteger()
            val sourceStarts = AtomicInteger()
            showDestination(activity, fixture, source, chosen, sourceStarts)
            val view = ready(activity)
            val player = onMain { view.player!! }
            onMain { player.seekTo(player.duration * 95 / 100) }
            waitFor("Up Next must be available") { action(activity) != null }
            assertTrue(Core.drainWrites())
            app.storage.beforeWrite = { key, _ ->
                if (key.startsWith("library")) Storage.Result.Err("Fixture storage failure")
                else null
            }
            onMain {
                player.seekTo(player.duration * 96 / 100)
                view.showController()
            }
            waitFor("Playback controls must finish appearing before Up enters the offer") {
                view.isControllerFullyVisible && view.hasFocus()
            }
            key(KeyEvent.KEYCODE_DPAD_UP)
            waitFor("Choose source must be focused") { action(activity)?.hasFocus() == true }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            withTimeout(15_000) {
                while (!focusedText().contains(context.getString(R.string.retry))) delay(80)
            }
            assertEquals(0, chosen.get())
            assertNotNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
            app.storage.beforeWrite = null
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Retry must open the retained next-episode source list exactly once") {
                chosen.get() == 1 &&
                    app.core.state.value.details.sources.any {
                        it.request.path.id == fixture.secondVideoId
                    }
            }
            assertNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
            assertEquals(0, sourceStarts.get())
        }
    }

    private fun showDestination(
        activity: PlaybackProbeActivity,
        fixture: CoreEpisodeFixture,
        source: Source,
        chosen: AtomicInteger,
        sourceStarts: AtomicInteger,
    ) {
        onMain {
            activity.setContent {
                var next by remember { mutableStateOf<Video?>(null) }
                val state by app.core.state.collectAsState()
                KinoTheme {
                    if (next == null)
                        FullscreenPlayer(
                            source,
                            fixture.media,
                            app.core,
                            onExit = { chosen.addAndGet(1000) },
                            onFailure = { chosen.addAndGet(1000) },
                            onUpNext = {
                                chosen.incrementAndGet()
                                next = it
                                app.core.open(fixture.media, it.id)
                            },
                        )
                    else
                        DetailScreen(
                            fixture.media,
                            next!!.id,
                            state.details,
                            null,
                            false,
                            onBack = {},
                            onEpisode = {},
                            onRetry = {},
                            onLibrary = {},
                            onSource = { sourceStarts.incrementAndGet() },
                        )
                }
            }
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

    @Test
    fun realSeekPositionsControlTheOfferAndRemoteFocusSurvivesHiddenControls() = runBlocking {
        for (asset in listOf("h264-sdr-aac.mp4", "up-next-long.mp4")) {
            withFixture(asset) { activity, fixture, source ->
                val departures = show(activity, fixture, source)
                val view = ready(activity)
                val player = onMain { view.player!! }
                val duration = onMain { player.duration }
                if (asset == "up-next-long.mp4") assertEquals(1_800_000L, duration)
                val threshold = duration - minOf(120_000L, duration / 10)
                onMain { player.seekTo(threshold - 500) }
                waitFor("Before the ending window the offer must stay hidden") {
                    player.playbackState == Player.STATE_READY && action(activity) == null
                }
                onMain { player.seekTo(threshold) }
                waitFor("The real ending position must reveal Choose source") {
                    action(activity) != null
                }
                assertFalse(
                    "Appearing must not steal focus",
                    onMain { action(activity)!!.hasFocus() },
                )
                assertEquals(0, departures.get())
                onMain { view.hideController() }
                instrumentation.waitForIdleSync()
                key(KeyEvent.KEYCODE_DPAD_UP)
                waitFor("The first D-pad press must reveal playback controls") {
                    view.isControllerFullyVisible
                }
                key(KeyEvent.KEYCODE_DPAD_UP)
                waitFor("Up must focus Choose source") { action(activity)?.hasFocus() == true }
                repeat(3) {
                    onMain { view.hideController() }
                    delay(180)
                    assertTrue(
                        "Hiding controls must retain offer focus",
                        onMain { action(activity)!!.hasFocus() },
                    )
                    key(KeyEvent.KEYCODE_DPAD_DOWN)
                    waitFor("Down must return to playback controls") {
                        view.hasFocus() && view.isControllerFullyVisible
                    }
                    key(KeyEvent.KEYCODE_DPAD_UP)
                    waitFor("Up must return to the offer") { action(activity)?.hasFocus() == true }
                }
                if (
                    asset == "h264-sdr-aac.mp4" &&
                        InstrumentationRegistry.getArguments().getString("upNextScreenshot") ==
                            "true"
                ) {
                    android.util.Log.i("KinoGate", "Up Next capture ready")
                    delay(10_000)
                }
                key(KeyEvent.KEYCODE_MEDIA_PLAY)
                waitFor("Media play must work with the offer focused") { player.isPlaying }
                key(KeyEvent.KEYCODE_MEDIA_PAUSE)
                waitFor("Media pause must work with the offer focused") { !player.isPlaying }
                onMain { player.seekTo(0) }
                waitFor("Seeking away must remove the focused offer and restore controls") {
                    action(activity) == null && view.hasFocus()
                }
                onMain { player.seekTo(threshold) }
                waitFor("Seeking back must restore the offer") { action(activity) != null }
                assertEquals(0, departures.get())
            }
        }
    }

    @Test
    fun unknownDurationOffersAtActualEofWithoutStartingTheNextEpisode() = runBlocking {
        withFixture("up-next-unknown.ts") { activity, fixture, source ->
            val departures = show(activity, fixture, source)
            val view = ready(activity)
            val player = onMain { view.player!! }
            assertEquals(C.TIME_UNSET, onMain { player.duration })
            assertNull(onMain { action(activity) })
            onMain { player.play() }
            delay(200)
            assertEquals(C.TIME_UNSET, onMain { player.duration })
            assertNull(onMain { action(activity) })
            context.contentResolver.call(endingUri, "finish", null, null)
            waitFor("Unknown duration must offer at real end-of-file") {
                player.playbackState == Player.STATE_ENDED && action(activity) != null
            }
            delay(300)
            assertEquals(0, departures.get())
            assertEquals(
                fixture.firstVideoId,
                onMain { Core.getState<CorePlayer>(Field.PLAYER).selected?.streamRequest?.path?.id },
            )
            assertFalse(onMain { player.isPlaying })
        }
    }

    @Test
    fun disabledUpNextAndTheLastEpisodeLeaveNormallyAtEof() = runBlocking {
        for (last in listOf(false, true)) {
            withFixture("h264-sdr-aac.mp4", last = last) { activity, fixture, source ->
                if (!last) app.settings.edit().putBoolean("up_next", false).commit()
                val departures = show(activity, fixture, source)
                val view = ready(activity)
                val player = onMain { view.player!! }
                onMain { player.seekTo(player.duration * 95 / 100) }
                waitFor("Disabled or absent next episode must not offer a source") {
                    player.playbackState == Player.STATE_READY && action(activity) == null
                }
                onMain {
                    player.seekTo(player.duration)
                    player.play()
                }
                waitFor("EOF without an offer must save and leave once") { departures.get() == 1 }
                assertNull(onMain { Core.getState<CorePlayer>(Field.PLAYER).selected })
            }
        }
    }

    @Test
    fun anotherSourceCannotRetainThePreviousOfferOrPlayer() = runBlocking {
        withFixture("h264-sdr-aac.mp4") { activity, fixture, source ->
            show(activity, fixture, source)
            val previous = ready(activity)
            onMain { previous.player!!.seekTo(previous.player!!.duration * 95 / 100) }
            waitFor("The first episode must offer its successor") { action(activity) != null }
            onMain { activity.setContent {} }
            waitFor("The old source must finish saving before replacement") {
                find<PlayerView>(activity.window.decorView) { true } == null &&
                    app.core.pendingPlaybackSave.status.value == TvPendingPlaybackSave.Status.Idle
            }
            assertNull(onMain { previous.player })
            onMain { app.core.open(fixture.media, fixture.secondVideoId) }
            waitFor("The replacement episode must resolve its own sources") {
                app.core.state.value.details.sources.any {
                    it.request.path.id == fixture.secondVideoId
                }
            }
            val nextSource = app.core.state.value.details.sources.first { it.playable }
            onMain {
                assertTrue(app.core.startPlayer(nextSource))
                assertNull(
                    "A new source must synchronously discard the previous next episode",
                    app.core.state.value.nextVideo,
                )
            }
            show(
                activity,
                fixture,
                nextSource.copy(stream = nextSource.stream.copy(source = source.stream.source)),
            )
            val replacement = ready(activity)
            assertNotSame(previous, replacement)
            onMain { replacement.player!!.seekTo(replacement.player!!.duration * 95 / 100) }
            waitFor("The final episode must not retain the earlier offer") {
                replacement.player!!.playbackState == Player.STATE_READY && action(activity) == null
            }
        }
    }

    private fun show(
        activity: PlaybackProbeActivity,
        fixture: CoreEpisodeFixture,
        source: Source,
    ): AtomicInteger {
        val departures = AtomicInteger()
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
                                departures.incrementAndGet()
                                departed = true
                            },
                            onFailure = { error ->
                                throw AssertionError("Playback failed with resource $error")
                            },
                            onUpNext = {
                                throw AssertionError(
                                    "An offer must not navigate without activation"
                                )
                            },
                        )
                }
            }
        }
        return departures
    }

    private fun ready(activity: PlaybackProbeActivity): PlayerView {
        var view: PlayerView? = null
        waitFor("Fullscreen player must decode the fixture") {
            view = find<PlayerView>(activity.window.decorView) { true }
            if (view?.player?.playbackState == Player.STATE_READY) {
                view!!.player!!.pause()
                true
            } else false
        }
        return view!!
    }

    private suspend fun withFixture(
        asset: String,
        last: Boolean = false,
        nextSeason: Int = 1,
        firstEpisode: Int = 1,
        block: suspend (PlaybackProbeActivity, CoreEpisodeFixture, Source) -> Unit,
    ) {
        onMain { app.core.initialize() }
        assertTrue(Core.drainWrites())
        app.settings.edit().remove("up_next").commit()
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val file = File(context.cacheDir, asset)
        instrumentation.context.assets.open(asset).use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        val fixture = CoreEpisodeFixture(activity, nextSeason, firstEpisode)
        if (asset == "up-next-unknown.ts")
            context.contentResolver.call(endingUri, "reset", null, null)
        try {
            val videoId = if (last) fixture.secondVideoId else fixture.firstVideoId
            onMain {
                fixture.install()
                app.core.open(fixture.media, videoId)
            }
            waitFor("Core must resolve the fixture's source") {
                app.core.state.value.details.sources.any {
                    it.playable && it.request.path.id == videoId
                }
            }
            val source = app.core.state.value.details.sources.first { it.playable }
            onMain { assertTrue(app.core.startPlayer(source)) }
            waitFor("Core must establish the matching playback selection and next episode") {
                val player = Core.getState<CorePlayer>(Field.PLAYER)
                player.selected?.streamRequest?.path?.id == videoId &&
                    player.libraryItem != null &&
                    if (last) app.core.state.value.nextVideo == null
                    else app.core.state.value.nextVideo?.id == fixture.secondVideoId
            }
            block(
                activity,
                fixture,
                source.copy(
                    stream =
                        source.stream.copy(
                            source =
                                Stream.Source.Url(
                                    Stream.Url(
                                        (if (asset == "up-next-unknown.ts") endingUri
                                            else Uri.fromFile(file))
                                            .toString()
                                    )
                                )
                        )
                ),
            )
        } finally {
            app.storage.beforeWrite = null
            if (asset == "up-next-unknown.ts")
                context.contentResolver.call(endingUri, "finish", null, null)
            onMain { activity.setContent {} }
            try {
                assertTrue(Core.drainWrites(retry = true))
                waitFor("Disposal must finish saving before the next fixture") {
                    if (
                        app.core.pendingPlaybackSave.status.value ==
                            TvPendingPlaybackSave.Status.Failed
                    )
                        app.core.pendingPlaybackSave.retry()
                    find<PlayerView>(activity.window.decorView) { true } == null &&
                        app.core.pendingPlaybackSave.status.value ==
                            TvPendingPlaybackSave.Status.Idle
                }
            } finally {
                onMain {
                    app.core.stopPlayer()
                    fixture.uninstall()
                    activity.finish()
                }
                Core.drainWrites(retry = true)
                fixture.close()
                file.delete()
                app.settings.edit().remove("up_next").commit()
            }
        }
    }

    private fun action(activity: PlaybackProbeActivity) =
        find<Button>(activity.window.decorView) {
            it.isShown && it.text == context.getString(R.string.choose_source)
        }

    private val endingUri =
        Uri.parse("content://${BuildConfig.APPLICATION_ID}.ending-fixture/unknown.ts")

    private fun nodeText(node: AccessibilityNodeInfo): String = buildString {
        append(node.text ?: "")
        for (index in 0 until node.childCount) node.getChild(index)?.let { append(nodeText(it)) }
    }

    private fun visibleText() =
        instrumentation.uiAutomation.rootInActiveWindow?.let(::nodeText).orEmpty()

    private fun focusedText(): String {
        return instrumentation.uiAutomation.rootInActiveWindow
            ?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?.let(::nodeText)
            .orEmpty()
    }

    private inline fun <reified T : View> find(view: View, predicate: (T) -> Boolean): T? =
        views(view).filterIsInstance<T>().firstOrNull(predicate)

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup)
            for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }

    private fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
    }

    private fun <T> onMain(read: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = read() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun waitFor(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (onMain(condition)) return
            Thread.sleep(50)
        }
        fail(reason)
    }
}
