package app.kino.tv

import android.content.Intent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.LibraryWithFilters
import com.stremio.core.runtime.msg.Action
import com.stremio.core.runtime.msg.ActionCtx
import com.stremio.core.types.resource.MetaItemBehaviorHints
import com.stremio.core.types.resource.MetaItemDeepLinks
import com.stremio.core.types.resource.MetaItemPreview
import com.stremio.core.types.resource.PosterShape
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Library cards say what Core knows about each title: marked watched, new episodes since it was
 * last watched, and how far a partly watched title got.
 */
class LibraryBadgesTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    private fun activity() =
        instrumentation.startActivitySync(
            Intent(context, PlaybackProbeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as PlaybackProbeActivity

    private fun ctx(args: ActionCtx.Args<*>) =
        Core.dispatch(Action(Action.Type.Ctx(ActionCtx(args))), Field.CTX)

    @Test
    fun coreMarksALibraryTitleWatchedOnItsCard() {
        val ids = listOf("kino-badge-watched", "kino-badge-plain")
        val activity = activity()
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                ids.forEach { id ->
                    ctx(
                        ActionCtx.Args.AddToLibrary(
                            MetaItemPreview(
                                id = id,
                                type = "movie",
                                name = if (id.endsWith("watched")) "Badge watched" else "Badge plain",
                                posterShape = PosterShape.POSTER,
                                behaviorHints = MetaItemBehaviorHints(hasScheduledVideos = false),
                                deepLinks = MetaItemDeepLinks(),
                                inLibrary = false,
                                watched = false,
                                inCinema = false,
                            )
                        )
                    )
                }
                ctx(
                    ActionCtx.Args.LibraryItemMarkAsWatched(
                        ActionCtx.LibraryItemMarkAsWatched(ids.first(), true)
                    )
                )
                core.selectLibrary(
                    LibraryWithFilters.LibraryRequest(sort = LibraryWithFilters.Sort.NAME, page = 1)
                )
                activity.setContent {
                    KinoTheme {
                        val state by core.state.collectAsState()
                        LibraryScreen(state.libraryPages, {})
                    }
                }
            }
            val watched = context.getString(R.string.watched_badge)
            val movie = context.getString(R.string.movie)
            remote.waitFor("Badge watched, $movie, $watched")
            remote.waitFor("Badge plain, $movie")
            assertNull("An unwatched title has no badge", remote.node("Badge plain, $movie, "))
        } finally {
            instrumentation.runOnMainSync {
                ids.forEach { ctx(ActionCtx.Args.RemoveFromLibrary(it)) }
                core.selectLibrary(
                    LibraryWithFilters.LibraryRequest(
                        sort = LibraryWithFilters.Sort.LAST_WATCHED,
                        page = 1,
                    )
                )
                activity.finish()
            }
        }
    }

    /**
     * New episodes and partial progress come from Core's notifications and playback, which a test
     * cannot produce on demand, so these cards are built from the fields Core fills.
     */
    @Test
    fun newEpisodesAndPartialProgressShowOnTheirCards() {
        val activity = activity()
        val items =
            listOf(
                Media("kino-new", "series", "Badge new", null, watched = true, newVideos = 3),
                Media("kino-half", "movie", "Badge half", null, progress = .4),
                Media("kino-done", "movie", "Badge done", null, progress = 1.0),
            )
        try {
            instrumentation.runOnMainSync {
                activity.setContent { KinoTheme { LibraryScreen(Library(items = items), {}) } }
            }
            val series = context.getString(R.string.series)
            val movie = context.getString(R.string.movie)
            val newEpisodes = context.resources.getQuantityString(R.plurals.new_episodes, 3, 3)
            // New episodes outrank watched, as on the desktop card.
            remote.waitFor("Badge new, $series, $newEpisodes")
            assertNull(remote.node(context.getString(R.string.watched_badge)))
            remote.waitFor(
                "Badge half, $movie, " + context.getString(R.string.progress_watched, 40)
            )
            // A title watched to the end has no partial bar to describe.
            remote.waitFor("Badge done, $movie")
            assertNull(remote.node("Badge done, $movie, "))
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
