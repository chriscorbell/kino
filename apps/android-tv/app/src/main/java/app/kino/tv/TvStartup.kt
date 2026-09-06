package app.kino.tv

internal enum class StartupScreen {
    Loading,
    Failed,
    SignIn,
    Welcome,
    Browse,
}

// Core publishes readiness and the restored profile together. Select the screen from that same
// snapshot, so an account never briefly renders the linking UI while an effect catches up.
internal fun startupScreen(
    state: TvState,
    accountProcess: Boolean,
    entered: Boolean,
): StartupScreen =
    when {
        !state.ready -> if (state.failed) StartupScreen.Failed else StartupScreen.Loading
        accountProcess && !state.signedIn -> StartupScreen.SignIn
        !entered && !state.signedIn -> StartupScreen.Welcome
        else -> StartupScreen.Browse
    }
