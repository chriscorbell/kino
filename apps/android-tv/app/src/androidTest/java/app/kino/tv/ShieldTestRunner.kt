package app.kino.tv

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

class ShieldTestApplication : KinoApplication() {
    override val core by lazy { TvCore(this, "instrumentation") }
}

class ShieldTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application {
        context.deleteSharedPreferences("stremio-core-instrumentation")
        return super.newApplication(cl, ShieldTestApplication::class.java.name, context)
    }

    override fun finish(resultCode: Int, results: android.os.Bundle) {
        targetContext.deleteSharedPreferences("stremio-core-instrumentation")
        super.finish(resultCode, results)
    }
}
