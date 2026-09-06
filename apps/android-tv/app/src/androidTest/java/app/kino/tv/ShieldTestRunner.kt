package app.kino.tv

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

class ShieldTestApplication : KinoApplication() {
    val storage by lazy { ControlledCoreStorage(CoreStorage(this, "instrumentation")) }
    override val core by lazy { TvCore(this, "instrumentation", storage) }
}

class ShieldTestRunner : AndroidJUnitRunner() {
    private var persistencePhase: String? = null

    override fun onCreate(arguments: android.os.Bundle) {
        persistencePhase = arguments.getString("persistencePhase")
        // Instrumentation arguments arrive after newApplication. Clear the
        // isolated profile here, before the runner starts its test thread.
        if (persistencePhase != "verify")
            targetContext.deleteSharedPreferences("stremio-core-instrumentation")
        super.onCreate(arguments)
    }

    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application {
        return super.newApplication(cl, ShieldTestApplication::class.java.name, context)
    }

    override fun finish(resultCode: Int, results: android.os.Bundle) {
        if (persistencePhase != "prepare")
            targetContext.deleteSharedPreferences("stremio-core-instrumentation")
        super.finish(resultCode, results)
    }
}
