package app.kino.tv

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.models.Ctx
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Sign-out ends the session at Stremio, not only on the TV. The prepare phase stores a signed-in
 * profile with a key Stremio never issued; a fresh process then signs out through Core, which must
 * send the session deletion and hear Stremio's answer before the profile is cleared.
 *
 * Runs only from `pnpm android:check`, which drives both phases with a process restart between.
 */
class LogoutTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val app
        get() = context.applicationContext as ShieldTestApplication

    private fun storage() =
        context.getSharedPreferences("stremio-core-${app.fixtureProfile}", Context.MODE_PRIVATE)

    @Test
    fun signOutEndsTheStremioSession() {
        val phase = InstrumentationRegistry.getArguments().getString("logoutPhase")
        assumeTrue(phase == "prepare" || phase == "verify")
        if (phase == "prepare") prepare() else verify()
    }

    private fun prepare() {
        instrumentation.runOnMainSync { app.core.initialize() }
        // Core stores its profile only once something changes it.
        assertTrue(
            kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.Main) {
                app.core.setLanguage(TvLanguage.English, false)
            }
        )
        val profile = JSONObject(storage().getString("profile", null)!!)
        profile.put(
            "auth",
            JSONObject(
                """{"key":"kino-logout-fixture-unissued-key","user":{"_id":"kino-logout-fixture",
                |"email":"logout-fixture@kino.invalid","fbId":null,"avatar":null,
                |"lastModified":"2026-01-01T00:00:00Z","dateRegistered":"2026-01-01T00:00:00Z",
                |"premium_expire":null,"gdpr_consent":{"tos":true,"privacy":true,
                |"marketing":false,"from":null}}}"""
                    .trimMargin()
            ),
        )
        assertTrue(storage().edit().putString("profile", profile.toString()).commit())
    }

    private fun verify() {
        val end = AtomicReference<TvCore.SessionEnd>()
        instrumentation.runOnMainSync {
            app.core.initialize()
            assertNotNull(
                "The stored session loads as signed in",
                Core.getState<Ctx>(Field.CTX).profile.auth,
            )
            app.core.logout { end.set(it) }
            assertTrue("Settings shows the sign-out in progress", app.core.state.value.signingOut)
        }
        val deadline = System.currentTimeMillis() + 15_000
        while (end.get() == null && System.currentTimeMillis() < deadline) Thread.sleep(100)
        assertNotNull("Sign-out finishes", end.get())
        assertNotEquals(
            "Stremio answered the session deletion rather than sign-out timing out",
            TvCore.SessionEnd.TimedOut,
            end.get(),
        )
        instrumentation.runOnMainSync {
            assertEquals(null, Core.getState<Ctx>(Field.CTX).profile.auth)
        }
        assertTrue(kotlinx.coroutines.runBlocking { Core.drainWrites() })
        assertFalse(
            "The stored profile no longer holds the session",
            JSONObject(storage().getString("profile", null)!!).has("auth") &&
                !JSONObject(storage().getString("profile", null)!!).isNull("auth"),
        )
    }
}
