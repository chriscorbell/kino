@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
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
 * The remote has to bring the controls back during the same playback session.
 * [PlayerView.dispatchKeyEvent] reveals them, but only for a view holding
 * Android focus, and hiding the controls takes their focused button away with
 * them. On a Shield the surrounding Compose hierarchy then reclaims focus and
 * every later press is lost, so these exercise the production [tvPlayerView]
 * with a competing Compose focus target present.
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
    fun theRemoteRevealsControlsAfterTheyAutoHide() {
        withPlayingSurface { surface ->
            val player = surface.player
            // The second cycle only passes if hiding the controls returned
            // focus to the surface; otherwise the first reveal is the last one.
            repeat(2) { cycle ->
                waitUntil("controls must auto-hide on cycle $cycle") {
                    !surface.view.isControllerFullyVisible
                }
                val positionBefore = onMain { player.currentPosition }

                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)

                waitUntil("the remote must reveal the controls on cycle $cycle") {
                    surface.view.isControllerFullyVisible
                }
                // Revealing must not disturb playback or throw away progress.
                assertTrue("Playback must keep running", onMain { player.isPlaying })
                assertTrue(
                    "Revealing must not restart or seek playback",
                    onMain { player.currentPosition } >= positionBefore,
                )
            }
        }
    }

    private class Surface(val player: ExoPlayer, val view: PlayerView)

    private fun withPlayingSurface(block: (Surface) -> Unit) {
        val fixture = File(context.cacheDir, "controls-fixture.mp4")
        instrumentation.context.assets.open("h264-sdr-aac.mp4").use { input ->
            fixture.outputStream().use { input.copyTo(it) }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        var session: MediaSession? = null
        var view: PlayerView? = null
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
                            factory = { tvPlayerView(it, presented).also { built -> view = built } },
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
                created.repeatMode = Player.REPEAT_MODE_ALL
                created.play()
            }
            val started = player!!
            waitUntil("the fixture must reach playback") {
                started.playbackState == Player.STATE_READY && started.isPlaying
            }
            waitUntil("the surface must be composed") { view != null }
            block(Surface(started, view!!))
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
