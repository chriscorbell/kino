package app.kino.tv

import android.content.SharedPreferences

/** Isolated preferences for gates that do not exercise cross-process ownership. */
internal class LocalKinoSettings(private val preferences: SharedPreferences) : KinoSettingsStore {
    override val all
        get() = preferences.all

    override fun getString(key: String, fallback: String?) = preferences.getString(key, fallback)

    override fun getBoolean(key: String, fallback: Boolean) = preferences.getBoolean(key, fallback)

    override fun edit(): KinoSettingsStore.Editor {
        val edit = preferences.edit()
        return object : KinoSettingsStore.Editor {
            override fun putString(key: String, value: String?) = apply {
                edit.putString(key, value)
            }

            override fun putBoolean(key: String, value: Boolean) = apply {
                edit.putBoolean(key, value)
            }

            override fun remove(key: String) = apply { edit.remove(key) }

            override fun clear() = apply { edit.clear() }

            override fun commit() = edit.commit()

            override fun apply() = edit.apply()
        }
    }
}
