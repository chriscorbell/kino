package app.kino.tv

import android.app.Application
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnitRunner
import okhttp3.ResponseBody.Companion.toResponseBody

private fun fixtureProfile(arguments: android.os.Bundle) =
    when (arguments.getString("settingsProfile")) {
        "guest" -> "instrumentation-settings-guest"
        "account" -> "instrumentation-settings-account"
        else -> "instrumentation"
    }

class ShieldTestApplication : KinoApplication() {
    val fixtureProfile
        get() = fixtureProfile(InstrumentationRegistry.getArguments())

    val storage by lazy { ControlledCoreStorage(CoreStorage(this, fixtureProfile)) }
    override val core by lazy { TvCore(this, fixtureProfile, storage) }
    var sharedSettingsFixture = false
    private val localSettings by lazy {
        LocalKinoSettings(getSharedPreferences("kino-$fixtureProfile", MODE_PRIVATE))
    }
    private val sharedSettings by lazy {
        SharedKinoSettings(
            this,
            android.net.Uri.parse("content://${BuildConfig.APPLICATION_ID}.settings-fixture"),
        )
    }
    override val settings: KinoSettingsStore
        get() = if (sharedSettingsFixture) sharedSettings else localSettings

    override val artworkProfile
        get() = fixtureProfile

    override val engine by lazy { TvStreamEngine(this, fixtureProfile) }

    // Screens under test must never reach GitHub, or raise a notice for a real release. UpdateTest
    // builds its own updater against a feed it answers itself.
    override val updates by lazy {
        TvUpdates(
            this,
            settings,
            source =
                UpdateSource(
                    client =
                        okhttp3.OkHttpClient.Builder()
                            .addInterceptor { chain ->
                                okhttp3.Response.Builder()
                                    .request(chain.request())
                                    .protocol(okhttp3.Protocol.HTTP_1_1)
                                    .code(404)
                                    .message("")
                                    .body(ByteArray(0).toResponseBody())
                                    .build()
                            }
                            .build()
                ),
        )
    }
}

class ShieldTestRunner : AndroidJUnitRunner() {
    private var persistencePhase: String? = null
    private var settingsPhase: String? = null
    private var logoutPhase: String? = null
    private var profile = "instrumentation"

    override fun onCreate(arguments: android.os.Bundle) {
        persistencePhase = arguments.getString("persistencePhase")
        settingsPhase = arguments.getString("settingsPhase")
        logoutPhase = arguments.getString("logoutPhase")
        profile = fixtureProfile(arguments)
        // Instrumentation arguments arrive after newApplication. Clear the
        // isolated profile here, before the runner starts its test thread.
        if (persistencePhase != "verify" && settingsPhase != "verify" && logoutPhase != "verify")
            targetContext.deleteSharedPreferences("stremio-core-$profile")
        if (settingsPhase != "verify") targetContext.deleteSharedPreferences("kino-$profile")
        super.onCreate(arguments)
    }

    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application {
        return super.newApplication(cl, ShieldTestApplication::class.java.name, context)
    }

    override fun finish(resultCode: Int, results: android.os.Bundle) {
        if (persistencePhase != "prepare" && settingsPhase != "prepare" && logoutPhase != "prepare")
            targetContext.deleteSharedPreferences("stremio-core-$profile")
        if (settingsPhase != "prepare") targetContext.deleteSharedPreferences("kino-$profile")
        super.finish(resultCode, results)
    }
}
