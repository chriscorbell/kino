@file:OptIn(androidx.compose.ui.InternalComposeUiApi::class)

package app.kino.tv

import android.content.Intent
import android.graphics.Rect
import android.view.Choreographer
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
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
        try {
            instrumentation.runOnMainSync {
                WindowRecomposerPolicy.withFactory(
                    WindowRecomposerFactory { it.createLifecycleAwareWindowRecomposer(scale) }
                ) {
                    activity.setContent {
                        KinoTheme {
                            val focus = remember { FocusRequester() }
                            val navigation = remember {
                                TvDestinations.associate { it.route to FocusRequester() }
                            }
                            TvNavigation("home", navigation, focus, false, {}, {}) {
                                Box(Modifier.fillMaxSize().focusRequester(focus).focusGroup()) {
                                    HomeScreen(
                                        TvState(
                                            shelves =
                                                listOf(
                                                    Shelf(
                                                        "movies",
                                                        "Movies",
                                                        (1..3).map {
                                                            Media(
                                                                "$it",
                                                                "movie",
                                                                "Motion $it",
                                                                null,
                                                            )
                                                        },
                                                        false,
                                                        false,
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
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
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
