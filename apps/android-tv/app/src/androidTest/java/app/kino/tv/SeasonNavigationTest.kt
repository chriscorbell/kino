@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.graphics.Rect
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.test.platform.app.InstrumentationRegistry
import androidx.tv.material3.Text
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.MetaDetails
import com.stremio.core.types.addon.ResourcePath
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.resource.*
import org.junit.Assert.*
import org.junit.Test

class SeasonNavigationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun episode(
        season: Int,
        number: Int,
        watched: Boolean = false,
        current: Boolean = false,
        upcoming: Boolean = false,
    ) =
        Video(
            id = "show:$season:$number",
            title = "Episode $number: A long title that wraps across the episode row",
            seriesInfo = Video.SeriesInfo(season.toLong(), number.toLong()),
            watched = watched,
            currentVideo = current,
            progress = if (current) 25.0 else null,
            upcoming = upcoming,
            deepLinks =
                VideoDeepLinks(
                    metaDetailsVideos = "",
                    metaDetailsStreams = "",
                    externalPlayer = VideoDeepLinks.ExternalPlayerLink(),
                ),
        )

    @Test
    fun librarySeriesBrowsesSeasonsWhileContinueWatchingLoadsItsSavedEpisode() {
        val core = (context.applicationContext as KinoApplication).core
        val series =
            Media(
                "season-entry-fixture",
                "series",
                "Entry fixture",
                null,
                videoId = "season-entry-fixture:2:1",
                progress = 0.25,
            )
        instrumentation.runOnMainSync {
            core.initialize()
            assertNull(series.entryVideoId())
            core.open(series)
            assertNull(Core.getState<MetaDetails>(Field.META_DETAILS).selected?.streamPath)
            val resume = series.copy(resume = true)
            assertEquals(series.videoId, resume.entryVideoId())
            core.open(resume)
            assertEquals(
                series.videoId,
                Core.getState<MetaDetails>(Field.META_DETAILS).selected?.streamPath?.id,
            )
            core.open(series, "season-entry-fixture:2:2")
            assertEquals(
                "season-entry-fixture:2:2",
                Core.getState<MetaDetails>(Field.META_DETAILS).selected?.streamPath?.id,
            )
        }
    }

    @Test
    fun coreVideoProgressSelectsTheSeasonWithoutMixingSpecialsOrUpcomingEpisodes() {
        val ordinary =
            listOf(episode(1, 1), episode(1, 2), episode(2, 1), episode(2, 2), episode(3, 1))
        assertEquals(1, initialSeason(ordinary))
        fun progress(season: Int, number: Int, watched: Boolean) =
            ordinary.map {
                if (it.id == "show:$season:$number")
                    it.copy(currentVideo = true, watched = watched, progress = 80.0)
                else it
            }
        assertEquals(2, initialSeason(progress(2, 1, false)))
        assertEquals(2, initialSeason(progress(2, 2, false)))
        assertEquals(2, initialSeason(progress(1, 2, true)))
        assertEquals(2, initialSeason(progress(2, 1, true)))
        assertEquals(3, initialSeason(progress(3, 1, true)))
        assertEquals(1, initialSeason(progress(1, 2, true) + episode(1, 3, upcoming = true)))
        assertEquals(4, initialSeason(listOf(episode(0, 1), episode(4, 1), episode(9, 1))))
        assertEquals(
            8,
            initialSeason(
                listOf(episode(8, 11), episode(2, 9, true, true), episode(0, 1), episode(2, 3))
            ),
        )
        assertEquals(0, initialSeason(listOf(episode(0, 1, true, true), episode(1, 1))))
        assertEquals(
            listOf(3L, 9L),
            seasonEpisodes(listOf(episode(2, 9), episode(0, 1), episode(2, 3)), 2).map {
                it.seriesInfo!!.episode
            },
        )
        assertEquals(-1, initialSeason(listOf(episode(1, 1).copy(seriesInfo = null))))
    }

    @Test
    fun remoteSeasonChoiceAndSourceBackPreserveTheEpisodeThroughPlaybackAndLateResponses() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val videos = listOf(0, 1, 2, 4).flatMap { season -> (1..24).map { episode(season, it) } }
        val meta =
            MetaItem(
                id = "show",
                type = "series",
                name = "Season fixture",
                posterShape = PosterShape.POSTER,
                videos = videos,
                behaviorHints = MetaItemBehaviorHints(hasScheduledVideos = false),
                deepLinks = MetaItemDeepLinks(),
                inLibrary = false,
                watched = false,
                receiveNotifications = false,
            )
        val media = Media("show", "series", "Season fixture", null)
        var videoId by mutableStateOf<String?>(null)
        var details by mutableStateOf(Details(meta = meta, loading = false, sourcesLoading = false))
        var playing by mutableStateOf(false)
        var error by mutableStateOf<Int?>(null)
        var profile by mutableIntStateOf(0)
        val requests = mutableListOf<String>()
        val source =
            Source(
                "Fixture provider",
                Stream(
                    source = Stream.Source.Url(Stream.Url("https://media.invalid/episode.mp4")),
                    name = "Current episode source",
                    behaviorHints = StreamBehaviorHints(notWebReady = false),
                    deepLinks =
                        StreamDeepLinks(
                            player = "",
                            externalPlayer = StreamDeepLinks.ExternalPlayerLink(),
                        ),
                ),
                ResourceRequest(
                    "https://addon.invalid/manifest.json",
                    ResourcePath("stream", "series", "show:2:10"),
                ),
            )
        val back = {
            videoId = null
            error = null
            details = details.copy(sources = emptyList(), sourcesLoading = false)
        }
        try {
            instrumentation.runOnMainSync {
                activity.setContent {
                    KinoTheme {
                        val saved = rememberSaveableStateHolder()
                        BackHandler(videoId != null && !playing, onBack = back)
                        if (playing) Text("Playback fixture")
                        else
                            saved.SaveableStateProvider(profile) {
                                DetailScreen(
                                    media,
                                    videoId,
                                    details,
                                    error,
                                    false,
                                    back,
                                    onEpisode = {
                                        videoId = it
                                        requests += it
                                        details =
                                            details.copy(
                                                sources = emptyList(),
                                                sourcesLoading = true,
                                            )
                                    },
                                    onRetry = {},
                                    onLibrary = {},
                                    onSource = { playing = true },
                                )
                            }
                    }
                }
            }
            waitFor("Season 1")
            focus("Season 1")
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Season 4")
            key(KeyEvent.KEYCODE_DPAD_DOWN)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("Season selection must not request an episode") {
                node("Season 2") != null && node("Season 4") == null
            }
            assertTrue(requests.isEmpty())
            instrumentation.runOnMainSync {
                details =
                    details.copy(
                        meta =
                            meta.copy(
                                videos =
                                    videos.map {
                                        it.copy(
                                            currentVideo = it.id == "show:4:1",
                                            progress = if (it.id == "show:4:1") 40.0 else null,
                                        )
                                    }
                            )
                    )
            }
            assertNotNull(node("Season 2"))
            focus("Season 2")
            repeat(10) { key(KeyEvent.KEYCODE_DPAD_DOWN) }
            waitUntil("The remote reaches episode ten") {
                node("Episode 10:")?.let(::focused) == true
            }
            val before = Rect().also { node("Episode 10:")!!.getBoundsInScreen(it) }
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("Only the explicit episode requests sources") {
                videoId == "show:2:10" && requests == listOf("show:2:10")
            }
            waitFor("Sources")
            assertNull(node(context.getString(R.string.add_library)))
            assertNotNull(node("Season 2 · Episode 10"))
            instrumentation.runOnMainSync {
                details =
                    details.copy(
                        sources =
                            listOf(
                                source.copy(
                                    request =
                                        source.request.copy(
                                            path = source.request.path.copy(id = "show:2:9")
                                        )
                                )
                            ),
                        sourcesLoading = false,
                    )
            }
            instrumentation.waitForIdleSync()
            assertNull("Old episode sources must not be selectable", node("Current episode source"))
            instrumentation.runOnMainSync { details = details.copy(sources = listOf(source)) }
            waitFor("Current episode source")
            focus("Current episode source")
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitFor("Playback fixture")
            instrumentation.runOnMainSync {
                playing = false
                error = R.string.playback_error
            }
            waitFor(context.getString(R.string.playback_error))
            key(KeyEvent.KEYCODE_BACK)
            waitUntil("Back restores the focused episode") {
                node("Episode 10:")?.let(::focused) == true
            }
            val after = Rect().also { node("Episode 10:")!!.getBoundsInScreen(it) }
            assertEquals("Back restores the same list offset", before, after)
            key(KeyEvent.KEYCODE_DPAD_CENTER)
            waitUntil("The restored row still belongs to Season 2") {
                requests == listOf("show:2:10", "show:2:10")
            }
            key(KeyEvent.KEYCODE_BACK)
            instrumentation.runOnMainSync {
                profile++
                details = Details(meta = meta, loading = false, sourcesLoading = false)
            }
            waitFor("Season 1")
        } finally {
            activity.finish()
        }
    }

    private fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
        Thread.sleep(80)
    }

    private fun nodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
        listOf(root) +
            (0 until root.childCount).flatMap { root.getChild(it)?.let(::nodes).orEmpty() }

    private fun node(text: String) =
        instrumentation.uiAutomation.rootInActiveWindow?.let(::nodes)?.firstOrNull {
            it.isVisibleToUser && it.text?.contains(text) == true
        }

    private fun focused(node: AccessibilityNodeInfo): Boolean {
        var target: AccessibilityNodeInfo? = node
        while (target != null) {
            if (target.isFocused) return true
            target = target.parent
        }
        return false
    }

    private fun focus(text: String) {
        var target = node(text) ?: error("Missing control: $text")
        while (!target.isFocusable && target.parent != null) target = target.parent
        assertTrue(
            "Control accepts remote focus: $text",
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS),
        )
    }

    private fun waitFor(text: String) =
        waitUntil("Missing visible text: $text") { node(text) != null }

    private fun waitUntil(reason: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10000
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (condition()) return
            Thread.sleep(100)
        }
        fail(
            reason +
                " Visible nodes: " +
                instrumentation.uiAutomation.rootInActiveWindow
                    ?.let(::nodes)
                    ?.filter { it.isVisibleToUser }
                    ?.map { "${it.text} focused=${it.isFocused} focusable=${it.isFocusable}" }
        )
    }
}
