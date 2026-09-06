package app.kino.tv

import androidx.activity.ComponentActivity

/** Instrumentation-only video surface host. No external intents or media URLs are accepted. */
class PlaybackProbeActivity : ComponentActivity() {
    external fun configureCoreFixture(port: Int)

    external fun requestPersistenceFixture(port: Int, put: Boolean, delayMs: Int)
}
