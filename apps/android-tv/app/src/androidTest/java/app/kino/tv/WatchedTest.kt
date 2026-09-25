@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.runtime.msg.Action
import com.stremio.core.runtime.msg.ActionCtx
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Marks episodes, a season, and a movie watched from the details page with the remote, and reads
 * the result back from Core rather than from the screen.
 */
class WatchedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    private fun <T> onMain(block: () -> T): T {
        val result = AtomicReference<T>()
        instrumentation.runOnMainSync { result.set(block()) }
        return result.get()
    }

    private fun activity() =
        instrumentation.startActivitySync(
            Intent(context, PlaybackProbeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as PlaybackProbeActivity

    private fun show(activity: PlaybackProbeActivity, media: Media) =
        instrumentation.runOnMainSync {
            activity.setContent {
                KinoTheme {
                    val state by core.state.collectAsState()
                    DetailScreen(
                        media,
                        null,
                        state.details,
                        null,
                        false,
                        {},
                        {},
                        {},
                        {},
                        {},
                        onWatched = core::markWatched,
                        onEpisodeWatched = core::markVideoWatched,
                        onSeasonWatched = core::markSeasonWatched,
                    )
                }
            }
        }

    private fun watched() =
        core.state.value.details.meta
            ?.videos
            .orEmpty()
            .associate { it.title to it.watched }

    @Test
    fun episodesAndSeasonsAreMarkedFromTheEpisodeList() {
        val activity = activity()
        val fixture = CoreEpisodeFixture(activity)
        try {
            onMain {
                core.initialize()
                fixture.install()
                core.open(fixture.media, null)
            }
            show(activity, fixture.media)
            val markFirst = context.getString(R.string.mark_episode_watched, "First episode")
            remote.waitFor(markFirst)
            remote.focus("First episode")
            remote.key(KeyEvent.KEYCODE_DPAD_RIGHT)
            assertTrue(
                "The toggle sits beside its episode",
                remote.node(markFirst)?.let(remote::focused) == true,
            )
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core records the episode") {
                watched() == mapOf("First episode" to true, "Second episode" to false)
            }
            val unmarkFirst = context.getString(R.string.mark_episode_unwatched, "First episode")
            remote.waitUntil("Focus stays on the toggle") {
                remote.node(unmarkFirst)?.let(remote::focused) == true
            }

            remote.focus(context.getString(R.string.mark_season_watched))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core records the season") { watched().values.all { it } }
            remote.waitFor(context.getString(R.string.mark_season_unwatched))
            remote.focus(context.getString(R.string.mark_season_unwatched))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core clears the season") { watched().values.none { it } }
            assertFalse(
                "Marking does not add the title to the library",
                core.state.value.details.meta!!.inLibrary,
            )
        } finally {
            onMain { fixture.uninstall() }
            fixture.close()
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    fun aMovieIsMarkedFromItsDetailsPage() {
        val activity = activity()
        val fixture = CoreCatalogFixture(activity)
        val movie = Media("kino-catalog-fixture-0", "movie", "Fixture movie", null)
        try {
            onMain {
                core.initialize()
                fixture.install()
                core.open(movie, null)
            }
            show(activity, movie)
            remote.waitFor(context.getString(R.string.mark_watched))
            remote.focus(context.getString(R.string.mark_watched))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core records the movie") {
                core.state.value.details.meta?.watched == true
            }
            remote.waitFor(context.getString(R.string.mark_unwatched))
            remote.focus(context.getString(R.string.mark_unwatched))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core clears the movie") {
                core.state.value.details.meta?.watched == false
            }
        } finally {
            onMain {
                Core.dispatch(
                    Action(Action.Type.Ctx(ActionCtx(ActionCtx.Args.RemoveFromLibrary(movie.id)))),
                    Field.CTX,
                )
                fixture.uninstall()
            }
            fixture.close()
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    fun holdingSelectRemovesATitleFromContinueWatching() {
        val activity = activity()
        val fixture = CoreEpisodeFixture(activity)
        try {
            onMain {
                core.initialize()
                fixture.install()
                core.open(fixture.media, fixture.firstVideoId)
            }
            remote.waitUntil("Core resolves the fixture's source", 15_000) {
                core.state.value.details.sources.any { it.playable }
            }
            onMain {
                assertTrue(core.startPlayer(core.state.value.details.sources.first { it.playable }))
            }
            // Core drops progress until the player has loaded the title's metadata.
            remote.waitUntil("Core records playback progress", 15_000) {
                onMain {
                    core.progress(60_000, 600_000, false)
                    core.resumePosition(fixture.firstVideoId) > 0
                }
            }
            onMain { core.stopPlayer() }
            remote.waitUntil("Playback puts the series in Continue Watching") {
                core.state.value.continueWatching.any { it.id == fixture.seriesId }
            }
            instrumentation.runOnMainSync {
                activity.setContent {
                    KinoTheme {
                        val state by core.state.collectAsState()
                        HomeScreen(state, {}, {}, core::removeFromContinueWatching)
                    }
                }
            }
            val resume = context.getString(R.string.resume_title, "Kino fixture")
            remote.waitFor(resume)
            remote.focus(resume)
            remote.hold(KeyEvent.KEYCODE_DPAD_CENTER)
            val remove = context.getString(R.string.continue_remove)
            remote.waitUntil("Holding select offers removal with focus on it") {
                remote.node(remove)?.let(remote::focused) == true
            }
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core takes the series out of Continue Watching") {
                core.state.value.continueWatching.none { it.id == fixture.seriesId }
            }
            remote.waitUntil("The shelf no longer shows it") { remote.node(resume) == null }
            remote.waitUntil("Focus stays on the page for the remote") {
                remote.visible().any { it.isFocused }
            }
        } finally {
            onMain { fixture.uninstall() }
            fixture.close()
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
