@file:OptIn(androidx.compose.ui.InternalComposeUiApi::class)

package app.kino.tv

import android.content.Intent
import android.graphics.Rect
import android.view.Choreographer
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.WindowRecomposerFactory
import androidx.compose.ui.platform.WindowRecomposerPolicy
import androidx.compose.ui.platform.createLifecycleAwareWindowRecomposer
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt
import org.junit.Assert.*
import org.junit.Test

class NavigationMotionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun disabledMotionSettlesPosterAndDrawerWithoutChangingDeviceSettings() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val scale =
            object : MotionDurationScale {
                override val scaleFactor = 0f
            }
        var empty by mutableStateOf(false)
        var loading by mutableStateOf(false)
        var parentBacks = 0
        val contentFocus = FocusRequester()
        val navigationFocus = TvDestinations.associate { it.route to FocusRequester() }
        try {
            instrumentation.runOnMainSync {
                WindowRecomposerPolicy.withFactory(
                    WindowRecomposerFactory { it.createLifecycleAwareWindowRecomposer(scale) }
                ) {
                    activity.setContent {
                        KinoTheme {
                            val focus = contentFocus
                            val navigation = navigationFocus
                            BackHandler { parentBacks++ }
                            TvNavigation("home", navigation, focus, false, {}, {}) {
                                Box(Modifier.fillMaxSize().focusRequester(focus).focusGroup()) {
                                    HomeScreen(
                                        TvState(
                                            shelves =
                                                listOf(
                                                    Shelf(
                                                        "movies",
                                                        "Movies",
                                                        (if (empty) emptyList()
                                                            else (1..3).toList())
                                                            .map {
                                                                Media(
                                                                    "$it",
                                                                    "movie",
                                                                    "Motion $it",
                                                                    null,
                                                                )
                                                            },
                                                        loading,
                                                        false,
                                                        name = "Popular",
                                                        type = "movie",
                                                    )
                                                )
                                        ),
                                        {},
                                        {},
                                    )
                                }
                                LaunchedEffect(Unit) {
                                    withFrameNanos {}
                                    focus.requestFocus()
                                }
                            }
                        }
                    }
                }
            }
            instrumentation.waitForIdleSync()
            frames(3)
            val base = bounds("Motion 2").width()
            val closedWidth = bounds(context.getString(R.string.home)).width()
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT)
            frames(2)
            assertTrue(
                "Focused poster settles in two frames with motion disabled",
                abs(bounds("Motion 2").width() - (base * 1.04f).roundToInt()) <= 2,
            )
            assertTrue(
                "Previous poster returns to its resting size",
                abs(bounds("Motion 1").width() - base) <= 2,
            )
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_LEFT)
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_LEFT)
            frames(2)
            val expanded = bounds(context.getString(R.string.home)).width()
            val density = context.resources.displayMetrics.density
            assertTrue(
                "Drawer reaches its full width with motion disabled",
                abs(expanded - 180 * density) <= 2,
            )
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            frames(2)
            val collapsed = bounds(context.getString(R.string.home)).width()
            assertTrue(
                "Back restores the drawer width without waiting for an animation",
                abs(collapsed - closedWidth) <= 2,
            )
            for (isLoading in listOf(true, false)) {
                instrumentation.runOnMainSync {
                    empty = true
                    loading = isLoading
                }
                frames(2)
                instrumentation.runOnMainSync { navigationFocus.getValue("home").requestFocus() }
                frames(2)
                assertTrue(
                    "Empty content still allows the drawer to open",
                    bounds(context.getString(R.string.home)).width() > closedWidth,
                )
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                frames(2)
                assertTrue(
                    "Back collapses the drawer when content has no focusable target (loading=$isLoading)",
                    abs(bounds(context.getString(R.string.home)).width() - closedWidth) <= 2,
                )
                val before = parentBacks
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
                frames(2)
                assertEquals(
                    "The collapsed drawer does not consume another Back",
                    before + 1,
                    parentBacks,
                )
                instrumentation.runOnMainSync { empty = false }
                frames(2)
                instrumentation.runOnMainSync { contentFocus.requestFocus() }
                frames(2)
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /**
     * The focused poster grows, and on a TV every focus change scrolls the list to put the focused
     * card's top on a fixed line. Growing from its centre moved that top on every move along a row,
     * and the page chased it up or down by a few pixels each time.
     */
    @Test
    fun movingAlongARowLeavesThePageStill() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val contentFocus = FocusRequester()
        val navigationFocus = TvDestinations.associate { it.route to FocusRequester() }
        try {
            instrumentation.runOnMainSync {
                activity.setContent {
                    KinoTheme {
                        TvNavigation("home", navigationFocus, contentFocus, false, {}, {}) {
                            Box(Modifier.fillMaxSize().focusRequester(contentFocus).focusGroup()) {
                                HomeScreen(
                                    TvState(
                                        shelves =
                                            (1..5).map { row ->
                                                Shelf(
                                                    "row-$row",
                                                    "Movies",
                                                    (1..12).map {
                                                        Media(
                                                            "$row-$it",
                                                            "movie",
                                                            // Titles that wrap to different line
                                                            // counts, as real ones do.
                                                            if (it % 3 == 0)
                                                                "Row $row a considerably longer " +
                                                                    "title $it"
                                                            else "Row $row title $it",
                                                            null,
                                                        )
                                                    },
                                                    false,
                                                    false,
                                                    name = "Shelf $row",
                                                    type = "movie",
                                                )
                                            }
                                    ),
                                    {},
                                    {},
                                )
                            }
                            LaunchedEffect(Unit) {
                                withFrameNanos {}
                                contentFocus.requestFocus()
                            }
                        }
                    }
                }
            }
            instrumentation.waitForIdleSync()
            repeat(2) {
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
                Thread.sleep(600)
            }
            val resting = textTop("Shelf 3")
            for (code in List(6) { KeyEvent.KEYCODE_DPAD_RIGHT } + List(6) { KeyEvent.KEYCODE_DPAD_LEFT }) {
                instrumentation.sendKeyDownUpSync(code)
                // Past the focus growth and the scroll that follows it.
                Thread.sleep(400)
                val top = textTop("Shelf 3")
                assertTrue(
                    "The page moved $resting to $top while focus moved along the row",
                    abs(top - resting) <= 1,
                )
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /** Where a piece of text sits on screen, without the focusable card around it. */
    private fun textTop(text: String): Int {
        val node =
            instrumentation.uiAutomation.rootInActiveWindow?.let(::nodes)?.firstOrNull {
                it.text?.toString() == text
            } ?: error("Missing $text")
        node.refresh()
        return Rect().also { node.getBoundsInScreen(it) }.top
    }

    private fun frames(count: Int) {
        val latch = CountDownLatch(1)
        instrumentation.runOnMainSync {
            fun next(remaining: Int) {
                Choreographer.getInstance().postFrameCallback {
                    if (remaining == 1) latch.countDown() else next(remaining - 1)
                }
            }
            next(count)
        }
        assertTrue(latch.await(3, TimeUnit.SECONDS))
    }

    private fun nodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
        listOf(root) +
            (0 until root.childCount).flatMap { root.getChild(it)?.let(::nodes).orEmpty() }

    private fun bounds(description: String): Rect {
        var node =
            instrumentation.uiAutomation.rootInActiveWindow?.let(::nodes)?.firstOrNull {
                (it.contentDescription?.toString() == description ||
                    it.contentDescription?.toString()?.startsWith("$description, ") == true)
            } ?: error("Missing $description")
        while (!node.isFocusable && node.parent != null) node = node.parent
        node.refresh()
        return Rect().also { node.getBoundsInScreen(it) }
    }
}
