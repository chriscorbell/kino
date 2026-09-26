@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.app.Activity
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Display
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.video.VideoFrameMetadataListener
import androidx.media3.common.Tracks
import kotlin.math.abs
import kotlin.math.roundToInt

/** A display mode, as far as matching a frame rate is concerned. */
internal data class ModeChoice(val id: Int, val width: Int, val height: Int, val refreshRate: Float)

internal fun Display.Mode.choice() = ModeChoice(modeId, physicalWidth, physicalHeight, refreshRate)

/**
 * The mode that shows [frameRate] without judder: the current resolution at that rate, or at the
 * smallest whole multiple of it. Null when the current mode already is one, or the display has
 * none. 23.976 and 24 differ by a tenth of a percent, a skipped frame every 42 seconds, so the
 * tolerance is well under that.
 */
internal fun matchingMode(modes: List<ModeChoice>, current: ModeChoice, frameRate: Float): ModeChoice? {
    if (!(frameRate > 1f)) return null
    fun multiple(rate: Float): Int? {
        val ratio = rate / frameRate
        val whole = ratio.roundToInt()
        return whole.takeIf { it >= 1 && abs(ratio - whole) < 0.0004f * ratio }
    }
    if (multiple(current.refreshRate) != null) return null
    return modes
        .filter { it.width == current.width && it.height == current.height }
        .mapNotNull { mode -> multiple(mode.refreshRate)?.let { mode to it } }
        .minByOrNull { it.second }
        ?.first
}

/** The rates video is made at. A measurement snaps to one of these, or to nothing. */
private val StandardRates =
    floatArrayOf(
        24000f / 1001f, 24f, 25f, 30000f / 1001f, 30f, 48000f / 1001f, 48f, 50f,
        60000f / 1001f, 60f, 100f, 120000f / 1001f, 120f,
    )

/**
 * The frame rate [frames] presentation times from [firstUs] to [lastUs] show, as the standard rate
 * it must be. Matroska stores times to the millisecond, so a rate measured over three seconds is
 * within about 0.03 percent, enough to tell 24 from 23.976, which differ by 0.1.
 */
internal fun measuredFrameRate(firstUs: Long, lastUs: Long, frames: Int): Float? {
    if (frames < 2 || lastUs <= firstUs) return null
    val estimate = (frames - 1) * 1_000_000f / (lastUs - firstUs)
    return StandardRates.minBy { abs(it - estimate) / it }.takeIf { abs(it - estimate) / it < 0.004f }
}

internal fun selectedVideoFormat(tracks: Tracks): Format? =
    tracks.groups
        .firstOrNull { it.type == C.TRACK_TYPE_VIDEO && it.isSelected }
        ?.let { group ->
            (0 until group.length).firstOrNull(group::isTrackSelected)?.let(group::getTrackFormat)
        }

/**
 * Switches the TV to the video's frame rate while it plays, when the viewer asked for it. The rate
 * comes from the container when it states one, and otherwise from the first three seconds of frame
 * times, since Matroska, the usual release container, does not. The TV goes dark for a moment
 * while it changes mode, so playback holds until the display reports the new mode, or five seconds
 * pass. Leaving playback hands the choice back to the system.
 *
 * The change also renegotiates HDMI audio, which Android reports as the audio output going away,
 * the broadcast Media3 pauses on so unplugged headphones do not go on playing. That pause is Kino's
 * own doing, and it can land after playback resumed, so for a while after asking for a mode it is
 * undone.
 */
internal class FrameRateMatcher(private val activity: Activity, private val player: ExoPlayer) {
    private val handler = Handler(Looper.getMainLooper())
    private val displays = activity.getSystemService(DisplayManager::class.java)
    private var requested = false
    private var waiting: (() -> Unit)? = null
    private var requestedAt = 0L
    private val renegotiation =
        object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (
                    !playWhenReady &&
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY &&
                        requested &&
                        waiting == null &&
                        SystemClock.elapsedRealtime() - requestedAt < RENEGOTIATION_MS
                ) {
                    Log.i("KinoPlayer", "Mode change audio pause undone")
                    player.playWhenReady = true
                }
            }
        }

    // Written on the playback thread only.
    private var firstUs = -1L
    private var lastUs = -1L
    private var frames = 0
    private var measured = false
    private val listener =
        VideoFrameMetadataListener { presentationTimeUs, _, format, _ ->
            if (measured) return@VideoFrameMetadataListener
            if (format.frameRate > 1f) {
                measured = true
                handler.post { request(format.frameRate) }
                return@VideoFrameMetadataListener
            }
            // A seek or a gap starts the measurement again.
            if (lastUs < 0 || presentationTimeUs <= lastUs || presentationTimeUs - lastUs > 250_000) {
                firstUs = presentationTimeUs
                frames = 0
            }
            lastUs = presentationTimeUs
            frames++
            if (lastUs - firstUs >= 3_000_000 && frames >= 30) {
                measured = true
                val rate = measuredFrameRate(firstUs, lastUs, frames)
                handler.post { rate?.let(::request) }
            }
        }

    init {
        player.setVideoFrameMetadataListener(listener)
        player.addListener(renegotiation)
    }

    fun onTracks(tracks: Tracks) {
        selectedVideoFormat(tracks)?.frameRate?.takeIf { it > 1f }?.let(::request)
    }

    private fun request(frameRate: Float) {
        if (requested) return
        val display = activity.window.decorView.display ?: return
        val target =
            matchingMode(display.supportedModes.map { it.choice() }, display.mode.choice(), frameRate)
                ?: return
        requested = true
        requestedAt = SystemClock.elapsedRealtime()
        val wasPlaying = player.playWhenReady
        player.playWhenReady = false
        lateinit var changes: DisplayManager.DisplayListener
        val resume: () -> Unit = {
            if (waiting != null) {
                waiting = null
                handler.removeCallbacksAndMessages(null)
                displays.unregisterDisplayListener(changes)
                if (wasPlaying) player.playWhenReady = true
            }
        }
        changes =
            object : DisplayManager.DisplayListener {
                override fun onDisplayChanged(displayId: Int) {
                    if (displayId == display.displayId && display.mode.modeId == target.id) resume()
                }

                override fun onDisplayAdded(displayId: Int) = Unit

                override fun onDisplayRemoved(displayId: Int) = Unit
            }
        waiting = resume
        displays.registerDisplayListener(changes, handler)
        handler.postDelayed({ resume() }, 5_000)
        activity.window.attributes =
            activity.window.attributes.apply { preferredDisplayModeId = target.id }
    }

    fun release() {
        player.clearVideoFrameMetadataListener(listener)
        player.removeListener(renegotiation)
        waiting = null
        handler.removeCallbacksAndMessages(null)
        if (requested)
            activity.window.attributes = activity.window.attributes.apply { preferredDisplayModeId = 0 }
    }

    private companion object {
        /**
         * How long after asking for a mode an audio-becoming-noisy pause is taken for the TV's
         * renegotiation. On the development Shield the broadcast came about three and a half
         * seconds after the request.
         */
        const val RENEGOTIATION_MS = 15_000L
    }
}
