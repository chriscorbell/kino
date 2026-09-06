package app.kino.tv

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import com.stremio.core.Storage
import okio.Path.Companion.toOkioPath

open class KinoApplication : Application(), SingletonImageLoader.Factory {
    val accountProcess
        get() = getProcessName().endsWith(":account")

    open val core by lazy { TvCore(this, if (accountProcess) "account" else "guest") }

    internal open val settings: KinoSettingsStore by lazy { SharedKinoSettings(this) }

    protected open val artworkProfile
        get() = if (accountProcess) "account" else "guest"

    override fun newImageLoader(context: Context): ImageLoader =
        ImageLoader.Builder(context)
            .diskCache {
                // Guest and account Cores live in separate processes. Coil cannot
                // safely share one disk journal between their image loaders.
                DiskCache.Builder()
                    .directory(java.io.File(cacheDir, "artwork-$artworkProfile").toOkioPath())
                    .build()
            }
            .build()
}

internal fun kinoSettings(context: Context) =
    (context.applicationContext as KinoApplication).settings

/** Core writes complete JSON values. commit acknowledges durable, app-private storage. */
class CoreStorage(context: Context, profile: String) : Storage {
    private val preferences =
        context.getSharedPreferences("stremio-core-$profile", Context.MODE_PRIVATE)

    override fun get(key: String): Storage.Result<String?> =
        try {
            Storage.Result.Ok(preferences.getString(key, null))
        } catch (_: Exception) {
            Storage.Result.Err("Storage read failed")
        }

    override fun set(key: String, value: String?): Storage.Result<Unit> =
        try {
            val editor = preferences.edit()
            if (value == null) editor.remove(key) else editor.putString(key, value)
            if (editor.commit()) Storage.Result.Ok(Unit)
            else Storage.Result.Err("Storage write failed")
        } catch (_: Exception) {
            Storage.Result.Err("Storage write failed")
        }
}
