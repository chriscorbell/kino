package app.kino.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class TvStartupTest {
    @Test
    fun restoredAccountGoesFromLoadingToBrowseWithoutSignIn() {
        val frames = listOf(TvState(), TvState(ready = true, signedIn = true))
        assertEquals(
            listOf(StartupScreen.Loading, StartupScreen.Browse),
            frames.map { startupScreen(it, accountProcess = true, entered = false) },
        )
    }

    @Test
    fun signInWaitsForAnUnsignedProfileAndDoesNotReplaceGuestWelcome() {
        assertEquals(StartupScreen.Loading, startupScreen(TvState(), true, true))
        val guest = TvState(ready = true)
        assertEquals(StartupScreen.SignIn, startupScreen(guest, true, true))
        assertEquals(StartupScreen.Welcome, startupScreen(guest, false, false))
        assertEquals(StartupScreen.Browse, startupScreen(guest, false, true))
        assertEquals(StartupScreen.Failed, startupScreen(TvState(failed = true), true, true))
    }
}
