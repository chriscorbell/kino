package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.Display
import android.view.KeyEvent
import android.view.SurfaceView
import androidx.activity.compose.setContent
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.types.resource.Stream
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Match frame rate: which display mode a video's rate asks for, and on the Shield, that a 24 fps
 * video switches the connected TV to 24 Hz before it plays, plays on once it has, and hands the
 * mode back the moment the viewer leaves the player. With the setting off, nothing asks.
 */
class FrameRateTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun theModeIsTheVideosRateOrAWholeMultipleOfIt() {
        val uhd = { id: Int, rate: Float -> ModeChoice(id, 3840, 2160, rate) }
        val modes =
            listOf(
                uhd(4, 23.976025f),
                uhd(14, 24.000002f),
                uhd(15, 25f),
                uhd(5, 29.97003f),
                uhd(16, 30.000002f),
                uhd(17, 50f),
                uhd(20, 59.94006f),
                uhd(19, 60.000004f),
                ModeChoice(9, 1920, 1080, 24.000002f),
            )
        val current = uhd(20, 59.94006f)
        assertEquals(14, matchingMode(modes, current, 24f)?.id)
        assertEquals(4, matchingMode(modes, current, 24000f / 1001f)?.id)
        assertEquals(15, matchingMode(modes, current, 25f)?.id)
        assertEquals(16, matchingMode(modes, current, 30f)?.id)
        // 59.94 already shows 29.97 without judder, so nothing changes.
        assertNull(matchingMode(modes, current, 30000f / 1001f))
        // Only the current resolution counts; a 1080p 24 Hz mode is never chosen for a 4K screen.
        assertNull(matchingMode(modes.filter { it.width == 1920 || it.id == 20 }, current, 24f))
        // Media3 reports an unknown rate as -1.
        assertNull(matchingMode(modes, current, -1f))
        // 50 Hz is the smallest multiple on offer for 25 fps when 25 Hz is not.
        assertEquals(17, matchingMode(modes.filter { it.id != 15 }, current, 25f)?.id)

        // Matroska times are whole milliseconds; three seconds of them still tell 24 from 23.976.
        fun measure(rate: Double, frames: Int): Float? {
            val times = (0 until frames).map { Math.round(it * 1000.0 / rate) * 1000L }
            return measuredFrameRate(times.first(), times.last(), frames)
        }
        assertEquals(24f, measure(24.0, 73))
        assertEquals(24000f / 1001f, measure(24000.0 / 1001.0, 73))
        assertEquals(25f, measure(25.0, 76))
        assertEquals(60000f / 1001f, measure(60000.0 / 1001.0, 181))
        assertNull("A rate that is no standard one is not guessed", measure(21.0, 64))
    }

    @Test
    fun aTwentyFourFrameVideoSwitchesTheTvBeforeItPlaysAndGivesItBack() {
        val file = fixture("frame-rate.mkv")
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        var matcher: FrameRateMatcher? = null
        var session: IntroDiscoverySession? = null
        var playedBeforeSwitch = false
        val display = activity.window.decorView.display
        val before = display.mode.modeId
        val target = twentyFourHertz(display)
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                // As in the player: the extractor reports the rate the Matroska track states,
                // which Media3 leaves off the format.
                session =
                    IntroDiscoverySession({}, {}, {}, onFrameRate = { matcher?.onStatedRate(it) })
                player =
                    createTvPlayer(
                            activity,
                            HardwareRenderers(activity),
                            extractorsFactory = IntroExtractorsFactory(session!!),
                        )
                        .apply {
                            setVideoSurfaceView(surface)
                            matcher = FrameRateMatcher(activity, this)
                            addListener(
                                object : Player.Listener {
                                    override fun onTracksChanged(tracks: Tracks) {
                                        matcher?.onTracks(tracks)
                                    }

                                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                                        if (isPlaying && display.mode.modeId != target.id)
                                            playedBeforeSwitch = true
                                    }
                                }
                            )
                            setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
                            prepare()
                            playWhenReady = true
                        }
            }
            waitUntil(display, "The TV switches to 24 Hz") { display.mode.modeId == target.id }
            waitUntil(display, "Playback resumes once the TV has switched") {
                player!!.isPlaying
            }
            instrumentation.runOnMainSync {
                assertFalse("The video must not play before the TV switches", playedBeforeSwitch)
                matcher?.release()
                player?.release()
                player = null
            }
            waitUntil(display, "The system's mode comes back after playback") {
                display.mode.modeId == before
            }
        } finally {
            instrumentation.runOnMainSync {
                session?.release()
                matcher?.release()
                player?.release()
                activity.finish()
            }
            file.delete()
        }
    }

    /** Leaving the player gives the mode back at once, before the player is even disposed. */
    @Test
    fun backFromThePlayerGivesTheModeBackAtOnce() = withPlayer(matchFrameRate = true) {
        activity,
        display,
        before,
        target ->
        waitUntil(display, "The TV switches to 24 Hz") { display.mode.modeId == target.id }
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        waitUntil(display, "Back hands the mode back while the player is still composed") {
            activity.window.attributes.preferredDisplayModeId == 0 &&
                display.mode.modeId == before
        }
    }

    /** With the setting off nothing asks for a mode, even after the measurement would have. */
    @Test
    fun nothingAsksForAModeWithTheSettingOff() = withPlayer(matchFrameRate = false) {
        activity,
        display,
        before,
        _ ->
        val deadline = System.currentTimeMillis() + 5_000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.runOnMainSync {
                assertEquals(0, activity.window.attributes.preferredDisplayModeId)
            }
            assertEquals(before, display.mode.modeId)
            Thread.sleep(250)
        }
    }

    private fun withPlayer(
        matchFrameRate: Boolean,
        block: (PlaybackProbeActivity, Display, Int, ModeChoice) -> Unit,
    ) {
        val app = context.applicationContext as ShieldTestApplication
        instrumentation.runOnMainSync { app.core.initialize() }
        assertTrue(runBlocking { Core.drainWrites() })
        app.settings.edit().putBoolean("match_frame_rate", matchFrameRate).commit()
        val file = fixture("frame-rate-player.mkv")
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val display = activity.window.decorView.display
        val before = display.mode.modeId
        val target = twentyFourHertz(display)
        val episode = CoreEpisodeFixture(activity)
        try {
            instrumentation.runOnMainSync {
                episode.install()
                app.core.open(episode.media, episode.firstVideoId)
            }
            waitUntil(display, "Core must resolve the fixture source") {
                app.core.state.value.details.sources.any { it.playable }
            }
            val selected = app.core.state.value.details.sources.first { it.playable }
            val local =
                selected.copy(
                    stream =
                        selected.stream.copy(
                            source = Stream.Source.Url(Stream.Url(Uri.fromFile(file).toString()))
                        )
                )
            instrumentation.runOnMainSync {
                assertTrue(app.core.startPlayer(selected))
                activity.setContent {
                    KinoTheme { FullscreenPlayer(local, episode.media, app.core, {}, {}, {}) }
                }
            }
            waitUntil(display, "The player starts") {
                find<PlayerView>(activity.window.decorView)?.player?.isPlaying == true
            }
            block(activity, display, before, target)
        } finally {
            instrumentation.runOnMainSync {
                activity.setContent {}
                app.core.stopPlayer()
                episode.uninstall()
            }
            runBlocking { Core.drainWrites(retry = true) }
            episode.close()
            instrumentation.runOnMainSync { activity.finish() }
            app.settings.edit().remove("match_frame_rate").commit()
            file.delete()
            waitUntil(display, "The system's mode comes back after the test") {
                display.mode.modeId == before
            }
        }
    }

    private fun fixture(name: String): File =
        File(context.cacheDir, name).also { file ->
            instrumentation.context.assets.open("hevc-sdr-ac3.mkv").use { input ->
                file.outputStream().use { input.copyTo(it) }
            }
        }

    private fun twentyFourHertz(display: Display): ModeChoice {
        val target =
            matchingMode(display.supportedModes.map { it.choice() }, display.mode.choice(), 24f)
        assertNotNull("The connected TV offers no 24 Hz mode at its resolution", target)
        return target!!
    }

    private fun waitUntil(display: Display, reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) {
            var met = false
            instrumentation.runOnMainSync { met = condition() }
            if (met) return
            Thread.sleep(100)
        }
        fail("$reason; display mode ${display.mode}")
    }

    private inline fun <reified T : android.view.View> find(view: android.view.View): T? =
        views(view).filterIsInstance<T>().firstOrNull()

    private fun views(view: android.view.View): Sequence<android.view.View> = sequence {
        yield(view)
        if (view is android.view.ViewGroup)
            for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }
}
