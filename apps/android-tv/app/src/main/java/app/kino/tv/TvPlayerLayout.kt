@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.Util
import androidx.media3.ui.PlayerView

/**
 * The player's remote, as Stremio's TV player has it, and the actions beside the controls.
 *
 * With the controls hidden, select plays or pauses and Left and Right seek, each bringing the
 * controls up; Stremio's first Left or Right only shows them, and Chris asked for the seek. With
 * the seek bar focused, Left and Right go on seeking and Down reaches the buttons below it, and Up
 * from those returns to it. A seek moves by the profile's seek step, the step grows while the
 * presses keep coming, and the seek lands half a second after the last, with the bar and the time
 * showing where until then. The media keys seek and play the same way.
 */
internal class TvPlayerLayout(context: Context, player: Player) : FrameLayout(context) {
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    /** The Stremio profile's seek step. */
    var seekStepMs: Long = 10_000L

    private val actions =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
        }
    private val offer =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            visibility = GONE
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background =
                GradientDrawable().apply {
                    setColor(KinoColors.Bg.copy(alpha = .94f).toArgb())
                    cornerRadius = dp(12).toFloat()
                }
        }
    val playerView: PlayerView =
        tvPlayerView(context, player) { actions.hasFocus() || notice.hasFocus() }
    private val skip =
        Button(context).apply {
            typeface = resources.getFont(R.font.geist_medium)
            textSize = 16f
            isAllCaps = false
            defaultFocusHighlightEnabled = false
            text = context.getString(R.string.skip_intro)
            minHeight = dp(48)
            minimumHeight = dp(48)
            setPadding(dp(20), 0, dp(20), 0)
            visibility = GONE
            setOnFocusChangeListener { _, focused -> styleButton(this, focused) }
        }
    private val title =
        TextView(context).apply {
            typeface = resources.getFont(R.font.geist_semibold)
            textSize = 18f
            setTextColor(KinoColors.Text.toArgb())
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
    private val choose =
        Button(context).apply {
            typeface = resources.getFont(R.font.geist_medium)
            textSize = 16f
            isAllCaps = false
            defaultFocusHighlightEnabled = false
            text = context.getString(R.string.choose_source)
            minHeight = dp(48)
            minimumHeight = dp(48)
            setPadding(dp(16), 0, dp(16), 0)
            setOnFocusChangeListener { _, focused -> styleButton(this, focused) }
        }
    private val undo =
        Button(context).apply {
            typeface = resources.getFont(R.font.geist_medium)
            textSize = 16f
            isAllCaps = false
            defaultFocusHighlightEnabled = false
            text = context.getString(R.string.undo)
            minHeight = dp(44)
            minimumHeight = dp(44)
            setPadding(dp(16), 0, dp(16), 0)
            setOnFocusChangeListener { _, focused -> styleButton(this, focused) }
        }
    private val notice =
        LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            visibility = GONE
            setPadding(dp(20), dp(12), dp(12), dp(12))
            background = panelBackground()
            addView(
                TextView(context).apply {
                    text = context.getString(R.string.intro_skipped)
                    textSize = 16f
                    typeface = resources.getFont(R.font.geist_medium)
                    setTextColor(KinoColors.Text.toArgb())
                },
                LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = dp(20)
                },
            )
            addView(undo, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, dp(44)))
        }
    private val hideNotice = Runnable { hideIntroNotice() }

    init {
        addView(playerView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        offer.addView(
            TextView(context).apply {
                text = context.getString(R.string.up_next)
                textSize = 14f
                typeface = resources.getFont(R.font.geist_medium)
                setTextColor(KinoColors.TextMuted.toArgb())
                isAccessibilityHeading = true
            }
        )
        offer.addView(
            title,
            LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(6)
                bottomMargin = dp(16)
            },
        )
        offer.addView(choose, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(48)))
        actions.addView(
            skip,
            LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, dp(48)).apply {
                bottomMargin = dp(12)
            },
        )
        actions.addView(
            offer,
            LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
        )
        addView(
            actions,
            LayoutParams(dp(320), LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply {
                bottomMargin = dp(148)
                marginEnd = dp(40)
            },
        )
        addView(
            notice,
            LayoutParams(
                    dp(320),
                    LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
                )
                .apply { bottomMargin = dp(148) },
        )
        styleButton(skip, false)
        styleButton(choose, false)
        styleButton(undo, false)
    }

    private fun panelBackground() =
        GradientDrawable().apply {
            setColor(KinoColors.Bg.copy(alpha = .94f).toArgb())
            cornerRadius = dp(12).toFloat()
        }

    private fun styleButton(button: Button, focused: Boolean) {
        button.setTextColor((if (focused) KinoColors.OnAccent else KinoColors.Text).toArgb())
        button.background =
            GradientDrawable().apply {
                setColor((if (focused) KinoColors.Accent else KinoColors.SurfaceHover).toArgb())
                cornerRadius = dp(8).toFloat()
                if (!focused) setStroke(dp(1), KinoColors.Border.toArgb())
            }
        button
            .animate()
            .scaleX(if (focused) 1.04f else 1f)
            .scaleY(if (focused) 1.04f else 1f)
            .setDuration(140)
            .start()
    }

    fun showUpNext(episodeTitle: String?, onChoose: () -> Unit) {
        choose.setOnClickListener { onChoose() }
        if (episodeTitle == null) {
            val restore = offer.hasFocus()
            offer.animate().cancel()
            offer.visibility = GONE
            if (restore) focusControls()
        } else {
            title.text = episodeTitle
            if (offer.visibility != VISIBLE) {
                offer.alpha = 0f
                offer.visibility = VISIBLE
                offer.animate().alpha(1f).setDuration(150).start()
            }
        }
    }

    fun showIntro(marker: TvIntroMarker?, durationMs: Long, inside: Boolean, onSkip: () -> Unit) {
        playerView
            .findViewById<TvIntroTimeBar>(androidx.media3.ui.R.id.exo_progress)
            ?.setIntro(marker, durationMs)
        skip.setOnClickListener { onSkip() }
        if (inside && skip.visibility != VISIBLE) {
            skip.alpha = 0f
            skip.visibility = VISIBLE
            skip.animate().alpha(1f).setDuration(150).start()
        } else if (!inside && skip.visibility != GONE) {
            val restore = skip.hasFocus()
            skip.animate().cancel()
            skip.visibility = GONE
            if (restore) focusControls()
        }
    }

    /** Opens Kino's subtitle panel from the controller's subtitle button. */
    fun onSubtitles(open: () -> Unit) {
        playerView.findViewById<View>(R.id.kino_subtitles)?.setOnClickListener { open() }
    }

    /** Gives the remote back to the controls after the subtitle panel closes. */
    fun restoreControlsFocus() {
        playerView.showController()
        val button = playerView.findViewById<View>(R.id.kino_subtitles)
        if (button?.requestFocus() != true) playerView.requestFocus()
    }

    fun showIntroNotice(onUndo: () -> Unit) {
        removeCallbacks(hideNotice)
        undo.setOnClickListener {
            hideIntroNotice()
            onUndo()
        }
        notice.alpha = 0f
        notice.visibility = VISIBLE
        notice.animate().alpha(1f).setDuration(150).start()
        undo.requestFocus()
        postDelayed(hideNotice, 8_000)
    }

    private fun hideIntroNotice() {
        removeCallbacks(hideNotice)
        val restore = notice.hasFocus()
        notice.animate().cancel()
        notice.visibility = GONE
        if (restore) playerView.requestFocus()
    }

    private fun focusControls() {
        playerView.showController()
        val play = playerView.findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)
        if (play?.requestFocus() != true) playerView.requestFocus()
    }

    private val timeBar
        get() = playerView.findViewById<TvIntroTimeBar>(androidx.media3.ui.R.id.exo_progress)

    private val playPause
        get() = playerView.findViewById<View>(androidx.media3.ui.R.id.exo_play_pause)

    private val position
        get() = playerView.findViewById<TvTimeText>(androidx.media3.ui.R.id.exo_position)

    private val buttons
        get() = playerView.findViewById<View>(androidx.media3.ui.R.id.exo_basic_controls)

    private var seekTarget = C.TIME_UNSET
    private var seekStep = 0L
    private var lastSeekAt = 0L
    private val landSeek = Runnable {
        val target = seekTarget
        seekTarget = C.TIME_UNSET
        if (target == C.TIME_UNSET) return@Runnable
        playerView.player?.seekTo(target)
        position?.preview(null)
        timeBar?.endPreview(target)
    }

    /** Where the remote is seeking to, before it lands; for the gates. */
    internal val pendingSeek: Long
        get() = seekTarget

    private fun seek(direction: Int) {
        val player = playerView.player ?: return
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: return
        val now = SystemClock.uptimeMillis()
        // Stremio's step grows by a ten-thousandth of the runtime with every press in a burst, so
        // holding the button crosses a film quickly, and starts over after a pause.
        if (seekTarget == C.TIME_UNSET || now - lastSeekAt > SEEK_SETTLE_MS) {
            if (seekTarget == C.TIME_UNSET) seekTarget = player.currentPosition
            seekStep = seekStepMs
        } else seekStep += duration / 10_000
        lastSeekAt = now
        seekTarget = (seekTarget + direction * seekStep).coerceIn(0, duration)
        timeBar?.preview(seekTarget)
        position?.preview(Util.getStringForTime(StringBuilder(), java.util.Formatter(), seekTarget))
        removeCallbacks(landSeek)
        postDelayed(landSeek, SEEK_SETTLE_MS)
    }

    private fun reveal(target: View?) {
        playerView.showController()
        if (target?.requestFocus() != true) target?.post { if (target.isShown) target.requestFocus() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if ((actions.hasFocus() || notice.hasFocus()) && playerView.dispatchMediaKeyEvent(event))
            return true
        if (!actions.hasFocus() && !notice.hasFocus() && remote(event)) return true
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN && actions.hasFocus()) {
            if (event.action == KeyEvent.ACTION_DOWN) focusControls()
            return true
        }
        if (
            event.keyCode == KeyEvent.KEYCODE_DPAD_UP &&
                playerView.isControllerFullyVisible &&
                !actions.hasFocus() &&
                !notice.hasFocus()
        ) {
            val target =
                when {
                    skip.visibility == VISIBLE -> skip
                    offer.visibility == VISIBLE -> choose
                    else -> null
                }
            if (target != null) {
                if (event.action == KeyEvent.ACTION_DOWN && !target.requestFocus()) {
                    target.post { if (target.isShown) target.requestFocus() }
                }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    /** The remote on the player itself, as Stremio's handles it. True when the key is taken. */
    private fun remote(event: KeyEvent): Boolean {
        // Up at all, animating in included: a quick second press is meant for the controls it
        // just brought up, not for the picture.
        val visible =
            playerView
                .findViewById<androidx.media3.ui.PlayerControlView>(
                    androidx.media3.ui.R.id.exo_controller
                )
                ?.isVisible == true
        val onBar = timeBar?.hasFocus() == true
        val down = event.action == KeyEvent.ACTION_DOWN
        when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                val media =
                    event.keyCode == KeyEvent.KEYCODE_MEDIA_REWIND ||
                        event.keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
                // Along the buttons, the arrows move focus instead.
                if (!visible || onBar || media) {
                    if (down) {
                        seek(
                            if (
                                event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
                                    event.keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
                            )
                                -1
                            else 1
                        )
                        reveal(timeBar)
                    }
                    return true
                }
            }
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                if (visible && !onBar) return false
                if (down && event.repeatCount == 0) {
                    playerView.player?.let(Util::handlePlayPauseButtonAction)
                    reveal(if (onBar) timeBar else playPause)
                }
                return true
            }
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (!visible) {
                    if (down) reveal(playPause)
                    return true
                }
                if (onBar && event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    if (down) reveal(playPause)
                    return true
                }
                if (buttons?.hasFocus() == true && event.keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                    if (down) reveal(timeBar)
                    return true
                }
            }
        }
        // Media3 takes a direction as "show the controls" until they have faded in, which lost a
        // quick second press; move focus as the shown controls would.
        val direction =
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> View.FOCUS_LEFT
                KeyEvent.KEYCODE_DPAD_RIGHT -> View.FOCUS_RIGHT
                KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
                KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
                else -> null
            }
        if (visible && direction != null && !playerView.isControllerFullyVisible) {
            if (down) {
                findFocus()?.focusSearch(direction)?.requestFocus()
                playerView.showController()
            }
            return true
        }
        return false
    }

    private companion object {
        /** Stremio lands a seek, and starts a new burst, half a second after the last press. */
        const val SEEK_SETTLE_MS = 500L
    }
}
