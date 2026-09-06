@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import androidx.media3.common.Player
import com.stremio.core.Core

/** One captured position and two durable drains, including writes caused by Unload. */
internal class TvPlaybackShutdown(player: Player, private val core: TvCore) {
    private var player: Player? = player
    private val generation = core.playerGeneration
    private var started = false
    private var unloaded = false
    var complete = false
        private set

    private fun capture() {
        if (!started) {
            player?.let {
                it.pause()
                core.progress(it.currentPosition, it.duration, true)
            }
            started = true
        }
    }

    /**
     * A disposed screen can release its decoder while the process keeps the captured save
     * retryable.
     */
    fun detach() {
        if (!complete && generation == core.playerGeneration) capture()
        player = null
    }

    suspend fun finish(retry: Boolean = false): Boolean {
        if (complete) return true
        // A disposed Activity may finish saving after another Activity starts a
        // source. Its old player must never unload that newer Core session.
        if (!unloaded && generation != core.playerGeneration) {
            player?.pause()
            player?.stop()
            complete = true
            return true
        }
        capture()
        if (!Core.drainWrites(retry)) return false
        if (!unloaded) {
            player?.stop()
            if (generation != core.playerGeneration) {
                complete = true
                return true
            }
            core.stopPlayer()
            unloaded = true
        }
        if (!Core.drainWrites(retry)) return false
        complete = true
        return true
    }
}
