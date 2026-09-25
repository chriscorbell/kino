package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The license notices the build packages are the ones the installed app can open, and a remote
 * reaches, scrolls, and leaves them from Settings.
 */
class LicensesTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val app = context.applicationContext as KinoApplication

    @Test
    fun everyPackagedNoticeOpensFromTheInstalledApp() {
        val index = readLicenseIndex(context)
        for (name in
            listOf(
                "Kino",
                "FFmpeg",
                "rust-standard-library",
                "stremio-core",
                "openssl-src",
                "androidx.media3:media3-exoplayer",
            ))
            assertTrue("The index lists $name", index.any { it.name == name })
        for (component in index) {
            val texts = readLicenseTexts(context, component)
            assertTrue(
                "${component.key} opens with text",
                texts.isNotEmpty() && texts.all { it.second.isNotBlank() },
            )
        }
        assertTrue(
            "Kino's own entry is the GPL",
            readLicenseTexts(context, index.first { it.name == "Kino" })
                .single()
                .second
                .contains("GNU GENERAL PUBLIC LICENSE"),
        )
        // Rust's HTML aggregation shows as its text extraction, not as markup.
        val rust = readLicenseTexts(context, index.first { it.name == "rust-standard-library" })
        assertTrue("No markup on screen", rust.none { it.second.contains("<details>") })
    }

    @Test
    fun remoteReadsANoticeFromSettingsAndReturns() {
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        try {
            instrumentation.runOnMainSync {
                app.core.initialize()
                activity.setContent {
                    val state by app.core.state.collectAsState()
                    KinoTheme { SettingsScreen(app.core, state, {}, {}, {}) }
                }
            }
            val readNotices = context.getString(R.string.read_notices)
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Read notices comes into view") {
                remote.node(readNotices) != null
            }
            remote.focus(readNotices)
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.licenses_intro))
            remote.waitUntil("Kino's own row takes focus") { remote.focusedOn("GPL-3.0-only") }

            remote.key(KeyEvent.KEYCODE_DPAD_DOWN)
            remote.waitUntil("FFmpeg follows Kino") { remote.focusedOn("LGPL-2.1-or-later") }
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor("Independent JPEG Group")
            remote.waitFor("Most files in FFmpeg")
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Down scrolls to the LGPL") {
                remote.node("GNU LESSER GENERAL PUBLIC LICENSE") != null
            }
            // The musl header comes after the whole LGPL.
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "Down scrolls past it", limit = 120) {
                remote.node("Rich Felker") != null
            }
            assertTrue("The page moved past its title", remote.node("FFmpeg n6.0.1") == null)

            remote.key(KeyEvent.KEYCODE_BACK)
            remote.waitUntil("Back returns to the FFmpeg row") {
                remote.focusedOn("LGPL-2.1-or-later")
            }

            val android = context.getString(R.string.licenses_scope_android) + " · "
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_UP, "Up reaches the section buttons") {
                remote.focusedOn(" · ")
            }
            remote.focus(android)
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("The jump lands on the first Android library") {
                remote.focusedOn("androidx.activity:activity")
            }

            remote.key(KeyEvent.KEYCODE_BACK)
            remote.waitUntil("Back returns to the row that opened the notices") {
                remote.focusedOn(readNotices)
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
