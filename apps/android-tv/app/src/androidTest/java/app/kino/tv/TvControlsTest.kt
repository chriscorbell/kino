@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.session.MediaSession
import androidx.media3.ui.PlayerView
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.*
import org.junit.Test

/**
 * The player's remote, as Stremio's TV player has it, driven through the production
 * [TvPlayerLayout] and [tvPlayerView] with a competing Compose focus target present, which on a
 * Shield reclaims focus whenever the controls hide.
 */
class TvControlsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun theSurfaceTakesFocusSoTheRemoteReachesIt() {
        withPlayingSurface { surface ->
            waitUntil("the surface must hold focus once it is on screen") {
                surface.view.hasFocus()
            }
        }
    }

    @Test
    fun theRemoteRevealsControlsAfterTheyAutoHideInThreeSeconds() {
        withPlayingSurface { surface ->
            val player = surface.player
            // The second cycle only passes if hiding the controls returned
            // focus to the surface; otherwise the first reveal is the last one.
            repeat(2) { cycle ->
                waitUntil("controls must auto-hide on cycle $cycle") {
                    !surface.view.isControllerFullyVisible
                }
                val positionBefore = onMain { player.currentPosition }

                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
                val revealed = System.currentTimeMillis()

                waitUntil("the remote must reveal the controls on cycle $cycle") {
                    surface.view.isControllerFullyVisible
                }
                assertTrue("Up must not pause playback", onMain { player.isPlaying })
                assertTrue(
                    "Revealing must not restart or seek playback",
                    onMain { player.currentPosition } >= positionBefore,
                )
                waitUntil("controls must hide while playing") {
                    !surface.view.isControllerFullyVisible
                }
                val shown = System.currentTimeMillis() - revealed
                assertTrue("Controls hid after $shown ms, not about three seconds", shown in 2_500..4_500)
            }
        }
    }

    @Test
    fun selectWithTheControlsHiddenPausesAndPlays() {
        withPlayingSurface { surface ->
            val player = surface.player
            waitUntil("controls must auto-hide") { !surface.view.isControllerFullyVisible }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("select must pause and show the controls on play and pause") {
                !player.isPlaying && surface.view.isControllerFullyVisible && playPause(surface).hasFocus()
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("select on play and pause must play again") { player.isPlaying }
        }
    }

    @Test
    fun leftAndRightSeekByTheProfileStepAndLandTogether() {
        withPlayingSurface { surface ->
            val player = surface.player
            val layout = surface.layout
            waitUntil("controls must auto-hide") { !surface.view.isControllerFullyVisible }
            val start = onMain { player.currentPosition }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            waitUntil("Right must seek at once and focus the seek bar") {
                layout.pendingSeek != C.TIME_UNSET && timeBar(surface).hasFocus()
            }
            val first = onMain { layout.pendingSeek }
            assertTrue(
                "One press moves by the profile's ten seconds, not $first from $start",
                first - start in 9_500L..10_600L,
            )
            // Two more within the burst: the step grows by a ten-thousandth of the runtime each time.
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            val duration = onMain { player.duration }
            val burst = onMain { layout.pendingSeek }
            val step = duration / 10_000
            assertTrue(
                "Three presses move by 30 s and the burst's growth, not ${burst - first} after the first",
                burst - first in (20_000L + 3 * step - 200)..(20_000L + 3 * step + 200),
            )
            assertTrue(
                "The seek waits for the burst to end",
                onMain { player.currentPosition } < burst - 15_000,
            )
            waitUntil("the burst lands half a second after the last press") {
                layout.pendingSeek == C.TIME_UNSET && player.currentPosition >= burst - 500
            }
            Thread.sleep(700)
            val landed = onMain { player.currentPosition }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_LEFT)
            waitUntil("Left after a pause starts a new burst of ten seconds") {
                layout.pendingSeek != C.TIME_UNSET
            }
            val back = onMain { layout.pendingSeek }
            assertTrue(
                "Left moves back by ten seconds from $landed, not to $back",
                landed - back in 9_000L..11_500L,
            )
        }
    }

    @Test
    fun downAndUpMoveBetweenTheSeekBarAndTheButtons() {
        withPlayingSurface { surface ->
            val player = surface.player
            waitUntil("controls must auto-hide") { !surface.view.isControllerFullyVisible }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            waitUntil("Right must focus the seek bar") { timeBar(surface).hasFocus() }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
            waitUntil("Down from the seek bar reaches play and pause") {
                playPause(surface).hasFocus()
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            waitUntil("Right along the buttons moves focus rather than seeking") {
                !playPause(surface).hasFocus() && surface.layout.pendingSeek == C.TIME_UNSET
            }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP)
            waitUntil("Up from the buttons returns to the seek bar") { timeBar(surface).hasFocus() }
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("select on the seek bar pauses, as Stremio's does") {
                !player.isPlaying && timeBar(surface).hasFocus()
            }
        }
    }

    private fun playPause(surface: Surface) =
        surface.view.findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)

    private fun timeBar(surface: Surface) =
        surface.view.findViewById<View>(androidx.media3.ui.R.id.exo_progress)

    private class Surface(val player: ExoPlayer, val layout: TvPlayerLayout) {
        val view: PlayerView = layout.playerView
    }

    private fun withPlayingSurface(block: (Surface) -> Unit) {
        // Five minutes, so there is room to seek either way.
        val fixture = File(context.cacheDir, "controls-fixture.mkv")
        instrumentation.context.assets.open("intro-no-chapters-long.mkv").use { input ->
            fixture.outputStream().use { input.copyTo(it) }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        var session: MediaSession? = null
        var layout: TvPlayerLayout? = null
        try {
            instrumentation.runOnMainSync {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val created = createTvPlayer(activity, HardwareRenderers(activity))
                player = created
                // Production builds one of these beside the player.
                session = MediaSession.Builder(activity, created).build()
                val presented = TvPresentationPlayer(created)
                activity.setContent {
                    Box(Modifier.fillMaxSize()) {
                        AndroidView(
                            factory = {
                                TvPlayerLayout(it, presented).also { built -> layout = built }
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                        // A Compose focus target beside the surface, standing in
                        // for the hierarchy that holds focus on a real Shield.
                        // Without one the surface is granted focus for free and
                        // the defect cannot appear.
                        Box(Modifier.focusable())
                    }
                }
                created.setMediaSource(
                    ProgressiveMediaSource.Factory(FileDataSource.Factory())
                        .createMediaSource(MediaItem.fromUri(Uri.fromFile(fixture)))
                )
                created.prepare()
                created.play()
            }
            val started = player!!
            waitUntil("the fixture must reach playback") {
                started.playbackState == Player.STATE_READY && started.isPlaying
            }
            waitUntil("the surface must be composed") { layout != null }
            block(Surface(started, layout!!))
        } finally {
            instrumentation.runOnMainSync {
                session?.release()
                player?.release()
            }
            activity.finish()
            fixture.delete()
        }
    }

    /** Reads a player or view value on the thread Media3 requires. */
    private fun <T> onMain(read: () -> T): T {
        var value: T? = null
        instrumentation.runOnMainSync { value = read() }
        @Suppress("UNCHECKED_CAST")
        return value as T
    }

    /** Conditions run on the main thread, so they must not post there again. */
    private fun waitUntil(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (onMain(condition)) return
            Thread.sleep(150)
        }
        fail(reason)
    }
}
