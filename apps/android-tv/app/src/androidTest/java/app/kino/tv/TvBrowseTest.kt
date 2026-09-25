@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.collectAsState
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.LibraryWithFilters
import com.stremio.core.runtime.msg.Action
import com.stremio.core.runtime.msg.ActionCtx
import com.stremio.core.types.addon.ResourceRequest
import com.stremio.core.types.resource.MetaItemBehaviorHints
import com.stremio.core.types.resource.MetaItemDeepLinks
import com.stremio.core.types.resource.MetaItemPreview
import com.stremio.core.types.resource.PosterShape
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives Discover and the Library through the real Core and a remote: paging past the first page
 * of a catalog and of the library, choosing a genre and a sort, all from the screen itself.
 */
class TvBrowseTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    private fun activity() =
        instrumentation.startActivitySync(
            Intent(context, PlaybackProbeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as PlaybackProbeActivity

    private fun show(activity: PlaybackProbeActivity, route: String) {
        val navigation = TvDestinations.associate { it.route to FocusRequester() }
        val contentFocus = FocusRequester()
        instrumentation.runOnMainSync {
            activity.setContent {
                KinoTheme {
                    val state by core.state.collectAsState()
                    TvNavigation(route, navigation, contentFocus, false, {}, {}) {
                        Box(Modifier.fillMaxSize().focusRequester(contentFocus).focusGroup()) {
                            if (route == "discover")
                                DiscoverScreen(
                                    state.discover,
                                    {},
                                    core::discover,
                                    core::loadMoreDiscover,
                                )
                            else
                                LibraryScreen(
                                    state.libraryPages,
                                    {},
                                    core::selectLibrary,
                                    core::loadMoreLibrary,
                                )
                        }
                    }
                }
            }
        }
    }

    @Test
    fun discoverPagesThroughACatalogAndFiltersByGenre() {
        val activity = activity()
        val fixture = CoreCatalogFixture(activity)
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                fixture.install()
                core.discover(fixture.catalogRequest)
            }
            show(activity, "discover")
            remote.waitFor("Fixture 1")
            val discover = core.state.value.discover
            assertTrue(
                "Core's catalog selector names the fixture",
                discover.catalogs.any { it.label == "Kino popular" && it.selected },
            )
            assertEquals(
                "The genre filter offers All and both genres",
                listOf(null, "Action", "Drama"),
                discover.filters.single().options.map { it.label },
            )
            assertTrue("A full first page offers another", discover.more)

            remote.focus("Fixture 1")
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Moving down loads the second page") {
                remote.node("Fixture 101") != null
            }
            assertTrue(fixture.requests.any { it.contains("skip=100") })
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Moving on reaches the last title") {
                remote.node("Fixture 250") != null
            }
            remote.waitUntil("An empty page ends the catalog") {
                fixture.requests.any { it.contains("skip=250") } &&
                    !core.state.value.discover.more
            }
            assertEquals(250, core.state.value.discover.items.size)

            remote.focus(context.getString(R.string.genre))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor("Drama")
            remote.focus("Action")
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor("Action 1")
            assertTrue(fixture.requests.any { it.contains("genre=Action") })
            assertTrue(
                "Only the genre's titles remain",
                core.state.value.discover.items.all { it.title.startsWith("Action ") },
            )
            assertEquals("A genre starts from its own first page", 20, core.state.value.discover.items.size)
        } finally {
            instrumentation.runOnMainSync {
                fixture.uninstall()
                activity.finish()
            }
            fixture.close()
        }
    }

    @Test
    fun homeGivesEachCatalogItsOwnRowThatOpensInDiscover() {
        val activity = activity()
        val fixture = CoreCatalogFixture(activity)
        val opened = java.util.concurrent.atomic.AtomicReference<ResourceRequest>()
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                fixture.install()
                core.home()
                activity.setContent {
                    KinoTheme {
                        val state by core.state.collectAsState()
                        HomeScreen(state, {}, core::home, onSeeAll = { opened.set(it) })
                    }
                }
            }
            // The default add-ons' rows come first; the fixture's catalog follows them.
            remote.waitFor("Popular")
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "The fixture's row comes into view") {
                remote.node("Kino popular") != null && remote.node("Fixture 1") != null
            }
            // The row names its type, since the catalog's name does not.
            val row = remote.node("Kino popular")!!
            assertTrue(
                "The row names its type beside the catalog name",
                remote.visible().any {
                    it.text?.toString() == context.getString(R.string.movies) &&
                        it.parent == row.parent
                },
            )
            val seeAll = context.getString(R.string.see_all_title, "Kino popular Movies")
            remote.focus("Fixture 1")
            // Twelve titles, then See all as the row's last stop. The presses are counted rather
            // than watched: after an earlier test in the same process, accessibility can report
            // the whole view as focused instead of the card, so what opens is the proof.
            repeat(12) { remote.key(KeyEvent.KEYCODE_DPAD_RIGHT) }
            remote.waitFor(seeAll)
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("See all opens the row's own catalog") {
                opened.get() == fixture.catalogRequest
            }
        } finally {
            instrumentation.runOnMainSync {
                fixture.uninstall()
                activity.finish()
            }
            fixture.close()
        }
    }

    @Test
    fun libraryPagesPastItsFirstHundredAndSortsByName() {
        val ids = (1..130).map { "kino-library-fixture-%03d".format(it) }
        fun ctx(args: ActionCtx.Args<*>) =
            Core.dispatch(Action(Action.Type.Ctx(ActionCtx(args))), Field.CTX)
        val activity = activity()
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                ids.forEachIndexed { index, id ->
                    ctx(
                        ActionCtx.Args.AddToLibrary(
                            MetaItemPreview(
                                id = id,
                                type = "movie",
                                name = "Shelved %03d".format(index + 1),
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
                core.selectLibrary(
                    LibraryWithFilters.LibraryRequest(
                        sort = LibraryWithFilters.Sort.NAME,
                        page = 1,
                    )
                )
            }
            show(activity, "library")
            remote.waitFor("Shelved 001")
            remote.waitUntil("The first page holds a hundred titles") {
                core.state.value.libraryPages.items.count { it.title.startsWith("Shelved") } ==
                    100 && core.state.value.libraryPages.more
            }
            remote.focus("Shelved 001")
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Moving down pages in the rest") {
                remote.node("Shelved 130") != null
            }

            remote.focus(context.getString(R.string.sort))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.sort_name_reverse))
            remote.focus(context.getString(R.string.sort_name_reverse))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Z to A puts the last title first") {
                core.state.value.libraryPages.items
                    .firstOrNull { it.title.startsWith("Shelved") }
                    ?.title == "Shelved 130"
            }
            assertFalse(
                "A new sort starts again from the first page",
                core.state.value.libraryPages.items.size > 100 &&
                    core.state.value.libraryPages.items.size < 130,
            )
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
}
