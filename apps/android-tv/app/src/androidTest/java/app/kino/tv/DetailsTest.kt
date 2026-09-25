@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test

/**
 * Reads a Cinemeta-shaped title through the real Core and checks what its details page shows:
 * the rating, genres, people, each episode's air date, and the scheduled episode marked Upcoming.
 */
class DetailsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    @Test
    fun detailsShowCreditsAndEpisodeDates() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val fixture = CoreEpisodeFixture(activity, details = true)
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                fixture.install()
                core.open(fixture.media, null)
                activity.setContent {
                    KinoTheme {
                        val state by core.state.collectAsState()
                        DetailScreen(fixture.media, null, state.details, null, false, {}, {}, {}, {}, {})
                    }
                }
            }
            remote.waitFor(context.getString(R.string.imdb_rating, "8.2"))
            remote.waitFor("Drama, Comedy")
            remote.waitFor(context.getString(R.string.cast))
            remote.waitFor("Ada Example")
            remote.waitFor(context.getString(R.string.director))
            remote.waitFor("Ben Example")
            // Air dates are calendar days in UTC, formatted for the device's locale.
            remote.waitFor("2020")
            remote.pressUntil(
                KeyEvent.KEYCODE_DPAD_DOWN,
                "The scheduled episode is marked Upcoming with its date",
                limit = 12,
            ) {
                remote.visible().any {
                    val text = it.text?.toString().orEmpty()
                    text.startsWith(context.getString(R.string.upcoming) + " · ") &&
                        text.contains("2099")
                }
            }
        } finally {
            instrumentation.runOnMainSync { fixture.uninstall() }
            fixture.close()
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
