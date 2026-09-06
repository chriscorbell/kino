@file:OptIn(
    androidx.tv.material3.ExperimentalTvMaterial3Api::class,
    coil3.annotation.DelicateCoilApi::class,
)

package app.kino.tv

import android.app.UiAutomation
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.KeyEvent
import android.view.Window
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.resource.*
import java.io.ByteArrayOutputStream
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import org.junit.Assert.*
import org.junit.Test

/** Measures rendered frames while remote input drives the production browsing components. */
class NavigationPerformanceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private var refreshRate = 60f
    private val frameResults = mutableMapOf<String, Double>()

    private data class Frame(
        val total: Long,
        val queued: Long,
        val layout: Long,
        val animation: Long,
    )

    private val automation =
        instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)

    @Test
    fun remoteBrowsingKeepsFocusAndFrameTimingWithLoadingAndLoadedArtwork() {
        assertEquals(
            "Measure the non-debuggable TV build",
            0,
            context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE,
        )
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        refreshRate = activity.display!!.refreshRate
        val originalLoader = SingletonImageLoader.get(context)
        val completedImages = AtomicInteger()
        val poster =
            ByteArrayOutputStream()
                .also { output ->
                    Bitmap.createBitmap(224, 336, Bitmap.Config.ARGB_8888).apply {
                        eraseColor(0xff455969.toInt())
                        compress(Bitmap.CompressFormat.PNG, 100, output)
                        recycle()
                    }
                }
                .toByteArray()
        var imageCache: coil3.memory.MemoryCache? = null
        val loader =
            ImageLoader.Builder(context)
                .components {
                    add(
                        object : Interceptor {
                            override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                                val cacheKey = chain.request.data.toString()
                                if (imageCache?.get(coil3.memory.MemoryCache.Key(cacheKey)) == null)
                                    delay(300)
                                val result =
                                    chain
                                        .withRequest(
                                            chain.request
                                                .newBuilder()
                                                .data(poster)
                                                .memoryCacheKey(cacheKey)
                                                .build()
                                        )
                                        .proceed()
                                if (
                                    result is coil3.request.SuccessResult &&
                                        result.dataSource != coil3.decode.DataSource.MEMORY_CACHE
                                )
                                    completedImages.incrementAndGet()
                                return result
                            }
                        }
                    )
                }
                .build()
        imageCache = loader.memoryCache
        SingletonImageLoader.setUnsafe(loader)
        val movies =
            (1..36).map {
                Media(
                    "movie-$it",
                    "movie",
                    "Movie $it",
                    "https://artwork.invalid/$it.png",
                    year = "2026",
                )
            }
        val series =
            (1..24).map {
                Media(
                    "series-$it",
                    "series",
                    "Series $it",
                    "https://artwork.invalid/series-$it.png",
                )
            }
        val shelves =
            listOf(
                Shelf("movies", "Movies", movies, false, false),
                Shelf("series", "Series", series, false, false),
            )
        val videos =
            (1..40).map {
                Video(
                    id = "series-1:1:$it",
                    title = "Episode $it",
                    seriesInfo = Video.SeriesInfo(1, it.toLong()),
                    upcoming = false,
                    watched = false,
                    currentVideo = false,
                    deepLinks =
                        VideoDeepLinks(
                            metaDetailsVideos = "",
                            metaDetailsStreams = "",
                            externalPlayer = VideoDeepLinks.ExternalPlayerLink(),
                        ),
                )
            }
        val meta =
            MetaItem(
                id = "series-1",
                type = "series",
                name = "Series 1",
                posterShape = PosterShape.POSTER,
                videos = videos,
                behaviorHints = MetaItemBehaviorHints(hasScheduledVideos = false),
                deepLinks = MetaItemDeepLinks(),
                inLibrary = false,
                watched = false,
                receiveNotifications = false,
            )
        var searchQuery by mutableStateOf("fixture")
        var route by mutableStateOf("home")
        var details by mutableStateOf(false)
        var episode by mutableStateOf<String?>(null)
        val frames = Collections.synchronizedList(mutableListOf<Frame>())
        val frameThread = HandlerThread("navigation-frames").apply { start() }
        val listener =
            Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
                if (metrics.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 0L)
                    frames +=
                        Frame(
                            metrics.getMetric(FrameMetrics.TOTAL_DURATION),
                            metrics.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION),
                            metrics.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION),
                            metrics.getMetric(FrameMetrics.ANIMATION_DURATION),
                        )
            }
        try {
            instrumentation.runOnMainSync {
                activity.window.addOnFrameMetricsAvailableListener(
                    listener,
                    Handler(frameThread.looper),
                )
                activity.setContent {
                    KinoTheme {
                        val focus = remember { FocusRequester() }
                        val navigation = remember {
                            TvDestinations.associate { it.route to FocusRequester() }
                        }
                        val saved = rememberSaveableStateHolder()
                        BackHandler(details) {
                            if (episode != null) episode = null else details = false
                        }
                        TvNavigation(
                            route,
                            navigation,
                            focus,
                            false,
                            {
                                route = it
                                details = false
                            },
                            {},
                        ) {
                            Box(
                                Modifier.fillMaxSize()
                                    .pageTransition(listOf(route, details, episode))
                                    .focusRequester(focus)
                                    .focusGroup()
                            ) {
                                if (details) {
                                    val sources =
                                        (1..40).map { index ->
                                            Source(
                                                "Fixture provider",
                                                Stream(
                                                    source =
                                                        Stream.Source.Url(
                                                            Stream.Url(
                                                                "https://media.invalid/$index.mp4"
                                                            )
                                                        ),
                                                    name = "Source $index",
                                                    behaviorHints =
                                                        StreamBehaviorHints(notWebReady = false),
                                                    deepLinks =
                                                        StreamDeepLinks(
                                                            "",
                                                            StreamDeepLinks.ExternalPlayerLink(),
                                                        ),
                                                ),
                                                ResourceRequest(
                                                    "https://addon.invalid/manifest.json",
                                                    ResourcePath("stream", "series", episode ?: ""),
                                                ),
                                            )
                                        }
                                    DetailScreen(
                                        series.first(),
                                        episode,
                                        Details(meta, sources, false, false),
                                        null,
                                        false,
                                        {
                                            if (episode != null) episode = null else details = false
                                        },
                                        { episode = it },
                                        {},
                                        {},
                                        {},
                                    )
                                } else
                                    saved.SaveableStateProvider(route) {
                                        when (route) {
                                            "home" ->
                                                HomeScreen(
                                                    TvState(ready = true, shelves = shelves),
                                                    { details = true },
                                                    {},
                                                )
                                            "search" ->
                                                SearchScreen(
                                                    searchQuery,
                                                    { searchQuery = it },
                                                    shelves,
                                                ) {
                                                    details = true
                                                }
                                            else ->
                                                LibraryScreen(movies + series) { details = true }
                                        }
                                    }
                                LaunchedEffect(route, details) {
                                    withFrameNanos {}
                                    if (!details) focus.requestFocus()
                                }
                            }
                        }
                    }
                }
            }
            waitFor("Movie 1")
            focus("Movie 1")
            burst(KeyEvent.KEYCODE_DPAD_RIGHT, 8)
            assertFocused("Movie 9")
            waitUntil("Artwork was decoded through Coil") { completedImages.get() >= 8 }
            burst(KeyEvent.KEYCODE_DPAD_LEFT, 8)
            assertFocused("Movie 1")
            frames.clear()
            repeat(3) {
                burst(KeyEvent.KEYCODE_DPAD_RIGHT, 8)
                assertFocused("Movie 9")
                burst(KeyEvent.KEYCODE_DPAD_LEFT, 8)
                assertFocused("Movie 1")
            }
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            assertFocused("Series 1")
            burst(KeyEvent.KEYCODE_DPAD_RIGHT, 8)
            assertFocused("Series 9")
            burst(KeyEvent.KEYCODE_DPAD_LEFT, 8)
            assertFocused("Series 1")
            key(KeyEvent.KEYCODE_DPAD_UP)
            assertFocused("Movie 1")
            reportFrames("home", frames)
            key(KeyEvent.KEYCODE_DPAD_LEFT)
            assertFocused(context.getString(R.string.home))
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            assertFocused("fixture", timeoutMs = 1000)
            fun keyboardVisible(): Boolean {
                var visible = false
                instrumentation.runOnMainSync {
                    visible =
                        ViewCompat.getRootWindowInsets(activity.window.decorView)
                            ?.isVisible(WindowInsetsCompat.Type.ime()) == true
                }
                return visible
            }
            assertFalse("Focusing Search does not open the keyboard", keyboardVisible())
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("Select opens the keyboard") { keyboardVisible() }
            key(KeyEvent.KEYCODE_BACK)
            waitUntil("Back dismisses the keyboard") { !keyboardVisible() }
            assertTrue(
                node("fixture")!!.performAction(
                    AccessibilityNodeInfo.ACTION_SET_TEXT,
                    android.os.Bundle().apply {
                        putCharSequence(
                            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                            "typed fixture",
                        )
                    },
                )
            )
            waitUntil("Input updates the parent query") { searchQuery == "typed fixture" }
            instrumentation.runOnMainSync { searchQuery = "restored fixture" }
            assertFocused("restored fixture", timeoutMs = 1000)
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            waitUntil("Down reaches a search result", timeoutMs = 200) {
                focusedLabel().startsWith("Movie ")
            }
            focus("Movie 1")
            frames.clear()
            burst(KeyEvent.KEYCODE_DPAD_RIGHT, 16)
            assertFocused("Movie 17")
            reportFrames("search", frames)
            focus(context.getString(R.string.search))
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            assertFocused(context.getString(R.string.all), timeoutMs = 1000)
            key(KeyEvent.KEYCODE_DPAD_LEFT)
            assertFocused(context.getString(R.string.library))
            key(KeyEvent.KEYCODE_BACK)
            assertFocused(context.getString(R.string.all), timeoutMs = 1000)
            focus("Movie 1")
            frames.clear()
            burst(KeyEvent.KEYCODE_DPAD_DOWN, 6)
            assertFocused("Series 1")
            reportFrames("library-loading", frames)
            frames.clear()
            repeat(2) {
                burst(KeyEvent.KEYCODE_DPAD_UP, 6)
                assertFocused("Movie 1")
                burst(KeyEvent.KEYCODE_DPAD_DOWN, 6)
            }
            reportFrames("library", frames)
            instrumentation.runOnMainSync { details = true }
            waitFor("Episode 1")
            focus("Episode 1")
            frames.clear()
            burst(KeyEvent.KEYCODE_DPAD_DOWN, 16)
            assertFocused("Episode 17")
            reportFrames("episodes", frames)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Source 1")
            focus("Source 1")
            frames.clear()
            burst(KeyEvent.KEYCODE_DPAD_DOWN, 16)
            assertFocused("Source 17")
            reportFrames("sources", frames)
            key(KeyEvent.KEYCODE_BACK)
            assertFocused("Episode 17", timeoutMs = 1000)
            assertTrue(
                "Frame budgets: $frameResults",
                frameResults.values.all { it < 2_000 / refreshRate },
            )
        } finally {
            if (
                InstrumentationRegistry.getArguments().getString("navigationScreenshot") == "true"
            ) {
                android.util.Log.i("KinoGate", "Navigation capture ready")
                Thread.sleep(10000)
            }
            instrumentation.runOnMainSync {
                activity.window.removeOnFrameMetricsAvailableListener(listener)
                activity.finish()
            }
            frameThread.quitSafely()
            SingletonImageLoader.setUnsafe(originalLoader)
            loader.shutdown()
        }
    }

    private fun reportFrames(screen: String, frames: MutableList<Frame>) {
        val values = synchronized(frames) { frames.sortedBy { it.total } }
        assertTrue("$screen produced enough rendered frames", values.size >= 10)
        val budget = 1_000_000_000.0 / refreshRate
        val p90 = values[((values.size - 1) * .9).toInt()].total / 1_000_000.0
        val missed = values.count { it.total > budget }
        println(
            "navigation_frames screen=$screen frames=${values.size} p90_ms=$p90 missed=$missed refresh_hz=${refreshRate}"
        )
        fun phase(read: (Frame) -> Long) =
            values.map(read).sorted()[((values.size - 1) * .9).toInt()] / 1_000_000.0
        val phases =
            "queued_p90_ms=${phase { it.queued }} layout_p90_ms=${phase { it.layout }} animation_p90_ms=${phase { it.animation }}"
        frameResults[screen] = p90
        instrumentation.addResults(
            android.os.Bundle().apply {
                putString(
                    "navigation_$screen",
                    "frames=${values.size} p90_ms=$p90 missed=$missed refresh_hz=$refreshRate $phases",
                )
            }
        )
    }

    private fun burst(code: Int, count: Int) {
        val down = SystemClock.uptimeMillis()
        repeat(count) { index ->
            instrumentation.sendKeySync(
                KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_DOWN, code, index)
            )
            Thread.sleep(80)
        }
        instrumentation.sendKeySync(
            KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0)
        )
        instrumentation.waitForIdleSync()
    }

    private fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
    }

    private fun nodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
        listOf(root) +
            (0 until root.childCount).flatMap { root.getChild(it)?.let(::nodes).orEmpty() }

    private fun node(text: String): AccessibilityNodeInfo? {
        val visible =
            automation.rootInActiveWindow?.let(::nodes)?.filter { it.isVisibleToUser }.orEmpty()
        // Poster captions are siblings of the focusable card; its description belongs to the card.
        return visible.firstOrNull {
            (it.contentDescription?.toString() == text ||
                it.contentDescription?.toString()?.startsWith("$text, ") == true)
        } ?: visible.firstOrNull { it.text?.toString() == text }
    }

    private fun focusedLabel() =
        automation.rootInActiveWindow
            ?.let(::nodes)
            ?.firstOrNull { it.isFocused }
            ?.let {
                nodes(it)
                    .mapNotNull { child -> child.contentDescription ?: child.text }
                    .joinToString(" ")
            }
            .orEmpty()

    // Page changes can leave an outgoing or incomplete accessibility node during the fade.
    private fun assertFocused(text: String, timeoutMs: Long = 200) =
        waitUntil("Expected focus $text, got ${focusedLabel()}", timeoutMs = timeoutMs) {
            var target = node(text)
            while (target != null && !target.isFocused) target = target.parent
            target?.isFocused == true
        }

    private fun focus(text: String) {
        waitUntil("Control accepts focus: $text") {
            var target = node(text)
            while (target != null && !target.isFocusable && target.parent != null) target =
                target.parent
            target?.isFocused == true ||
                target?.performAction(AccessibilityNodeInfo.ACTION_FOCUS) == true
        }
        assertFocused(text)
    }

    private fun waitFor(text: String) = waitUntil("Missing $text") { node(text) != null }

    private fun waitUntil(reason: String, timeoutMs: Long = 5000, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(40)
        }
        fail(
            reason +
                " Nodes: " +
                automation.rootInActiveWindow
                    ?.let(::nodes)
                    ?.filter { it.isVisibleToUser }
                    ?.map {
                        "text=${it.text} description=${it.contentDescription} focused=${it.isFocused} focusable=${it.isFocusable}"
                    }
        )
    }
}
