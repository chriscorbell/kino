@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kino.tv

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView

/** Actions remain reachable when Media3 hides its controls and consumes the first D-pad press. */
internal class TvPlayerLayout(context: Context, player: Player) : FrameLayout(context) {
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

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

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if ((actions.hasFocus() || notice.hasFocus()) && playerView.dispatchMediaKeyEvent(event))
            return true
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
}
