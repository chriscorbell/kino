@file:OptIn(androidx.tv.material3.ExperimentalTvMaterial3Api::class)

package app.kino.tv

import android.content.Intent
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Installs an add-on by typing its address with the remote, through Core's own manifest fetch, and
 * removes it again. A protected add-on offers no removal.
 */
class TvAddonsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val remote = TvRemote(instrumentation)
    private val core = (context.applicationContext as KinoApplication).core

    private fun keyboardShown(): Boolean {
        val out =
            instrumentation.uiAutomation.executeShellCommand("dumpsys input_method").use {
                android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
            }
        return out.contains("mInputShown=true")
    }

    @Test
    fun addonIsInstalledFromItsAddressAndRemoved() {
        assertEquals(
            "https://example.invalid/a/manifest.json",
            addonManifestUrl(" stremio://example.invalid/a/manifest.json "),
        )
        assertNull(addonManifestUrl("http://example.invalid/manifest.json"))
        assertNull(addonManifestUrl("https://user:secret@example.invalid/manifest.json"))
        assertNull(addonManifestUrl("https://example.invalid/catalog.json"))

        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        val fixture = CoreCatalogFixture(activity)
        val name = "Kino catalog fixture"
        try {
            instrumentation.runOnMainSync {
                core.initialize()
                fixture.route()
                activity.setContent {
                    KinoTheme {
                        val state by core.state.collectAsState()
                        AddonsScreen(state, core)
                    }
                }
            }
            remote.waitFor(context.getString(R.string.addon_built_in))
            remote.focus(context.getString(R.string.install_addon))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.addon_url_hint))
            instrumentation.sendStringSync("stremio://kino-fixture.invalid/browse/manifest.json")
            // The on-screen keyboard is up and owns the keys; Back puts it away, as a viewer
            // does before moving to the dialog's buttons.
            remote.waitUntil("Typing opens the on-screen keyboard") { keyboardShown() }
            remote.key(KeyEvent.KEYCODE_BACK)
            remote.waitUntil("Back puts the keyboard away") { !keyboardShown() }
            remote.focus(context.getString(R.string.addon_continue))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor("$name 1.0.0")
            remote.focusExact(context.getString(R.string.install))
            remote.waitUntil("Install holds focus") {
                remote.focusedExact(context.getString(R.string.install))
            }
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core installs the add-on") {
                core.state.value.addons.any { it.manifest.name == name }
            }
            // New add-ons join the end of the list, below the defaults.
            remote.pressUntil(KeyEvent.KEYCODE_DPAD_DOWN, "The new add-on's row comes into view") {
                remote.node(name) != null
            }
            remote.focus(name)
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitFor(context.getString(R.string.remove_addon_title, name))
            remote.focusExact(context.getString(R.string.remove_addon))
            remote.key(KeyEvent.KEYCODE_DPAD_CENTER)
            remote.waitUntil("Core removes the add-on") {
                core.state.value.addons.none { it.manifest.name == name }
            }
        } finally {
            instrumentation.runOnMainSync {
                if (core.state.value.addons.any { it.manifest.name == name }) fixture.uninstall()
                activity.finish()
            }
            fixture.close()
        }
    }
}
