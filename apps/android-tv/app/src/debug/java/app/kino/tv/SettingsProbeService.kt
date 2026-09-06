package app.kino.tv

import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.*

class SettingsCoverActivity : androidx.activity.ComponentActivity()

/** Separate-process fixture using the production provider and client with isolated storage. */
class SettingsFixtureProvider : KinoSettingsProvider() {
    override val preferencesName = "kino-instrumentation-shared"
}

class SettingsProbeService : Service() {
    private val messages by lazy {
        Messenger(
            object : Handler(Looper.getMainLooper()) {
                override fun handleMessage(message: Message) {
                    val settings =
                        SharedKinoSettings(
                            this@SettingsProbeService,
                            Uri.parse("content://${BuildConfig.APPLICATION_ID}.settings-fixture"),
                        )
                    if (message.what == 2) {
                        check(
                            settings
                                .edit()
                                .putString("audio_output", "stereo")
                                .putBoolean("subtitles", true)
                                .putString("tracks-v1:remote", "remote choice fixture")
                                .commit()
                        )
                    }
                    message.replyTo.send(
                        Message.obtain(null, message.what).apply {
                            data =
                                Bundle().apply {
                                    putInt("pid", Process.myPid())
                                    putString("audio", settings.getString("audio_output", "auto"))
                                    putBoolean("subtitles", settings.getBoolean("subtitles", false))
                                    putString("main", settings.getString("tracks-v1:main", null))
                                }
                        }
                    )
                }
            }
        )
    }

    override fun onBind(intent: Intent) = messages.binder
}
