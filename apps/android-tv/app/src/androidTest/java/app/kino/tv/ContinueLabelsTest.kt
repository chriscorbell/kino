package app.kino.tv

import android.content.Intent
import androidx.activity.compose.setContent
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Continue Watching names the saved episode when its id follows Stremio's series convention. */
class ContinueLabelsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)

    @Test
    fun continueWatchingNamesTheSavedEpisode() {
        assertEquals(2 to 5, episodeFromVideoId("tt0903747", "tt0903747:2:5"))
        assertNull(episodeFromVideoId("tt0903747", "tt1234567:2:5"))
        assertNull(episodeFromVideoId("kitsu:1", "kitsu:1:12"))
        assertNull(episodeFromVideoId("show", "show:1:2:3"))

        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val items =
            listOf(
                Media("tt0903747", "series", "Breaking Bad", null, videoId = "tt0903747:2:5", resume = true, progress = .4),
                Media("kino-show", "series", "Own ids", null, videoId = "kino-show:episode-4", resume = true, progress = .4),
                Media("tt0012349", "movie", "The Kid", null, videoId = "tt0012349", resume = true, progress = .4),
            )
        try {
            instrumentation.runOnMainSync {
                activity.setContent {
                    KinoTheme { HomeScreen(TvState(ready = true, continueWatching = items), {}, {}) }
                }
            }
            val named =
                context.getString(R.string.resume_title, "Breaking Bad") + ", " +
                    context.getString(R.string.season_episode, 2, 5)
            // The card speaks the full label; its "S2 E5" caption repeats it only visually.
            remote.waitFor(named)
            remote.waitFor(context.getString(R.string.resume_title, "Own ids"))
            assertNull(remote.node(context.getString(R.string.resume_title, "Own ids") + ", "))
            assertNull(remote.node(context.getString(R.string.resume_title, "The Kid") + ", "))
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
