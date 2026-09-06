package app.kino.tv

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Bundle

/** Device preferences have one writer even while guest and account processes coexist. */
internal interface KinoSettingsStore {
    val all: Map<String, *>

    fun getString(key: String, fallback: String?): String?

    fun getBoolean(key: String, fallback: Boolean): Boolean

    fun edit(): Editor

    interface Editor {
        fun putString(key: String, value: String?): Editor

        fun putBoolean(key: String, value: Boolean): Editor

        fun remove(key: String): Editor

        fun clear(): Editor

        fun commit(): Boolean

        fun apply()
    }
}

internal class SharedKinoSettings(
    context: Context,
    private val uri: Uri = Uri.parse("content://${BuildConfig.APPLICATION_ID}.settings"),
) : KinoSettingsStore {
    private val resolver = context.applicationContext.contentResolver

    @Suppress("DEPRECATION")
    override val all: Map<String, *>
        get() {
            val values = checkNotNull(resolver.call(uri, "read", null, null))
            return values.keySet().associateWith { values.get(it) }
        }

    override fun getString(key: String, fallback: String?) = all[key] as String? ?: fallback

    override fun getBoolean(key: String, fallback: Boolean) = all[key] as Boolean? ?: fallback

    override fun edit(): KinoSettingsStore.Editor =
        object : KinoSettingsStore.Editor {
            private val values = Bundle()
            private val removed = mutableSetOf<String>()
            private var clear = false

            override fun putString(key: String, value: String?) = apply {
                if (value == null) remove(key)
                else {
                    values.putString(key, value)
                    removed.remove(key)
                }
            }

            override fun putBoolean(key: String, value: Boolean) = apply {
                values.putBoolean(key, value)
                removed.remove(key)
            }

            override fun remove(key: String) = apply {
                values.remove(key)
                removed.add(key)
            }

            override fun clear() = apply { clear = true }

            private fun write(method: String): Boolean {
                val request =
                    Bundle().apply {
                        putBundle("values", Bundle(values))
                        putStringArrayList("removed", ArrayList(removed))
                        putBoolean("clear", clear)
                    }
                return resolver.call(uri, method, null, request)?.getBoolean("saved") == true
            }

            override fun commit() = write("commit")

            override fun apply() {
                check(write("apply"))
            }
        }
}

/** Internal provider in the default process. Account callers never open its file directly. */
open class KinoSettingsProvider : ContentProvider() {
    protected open val preferencesName = "kino"
    private val preferences by lazy {
        requireNotNull(context).getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
    }

    override fun onCreate() = true

    @Suppress("DEPRECATION")
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        if (method == "read")
            return Bundle().apply {
                for ((key, value) in preferences.all) when (value) {
                    is String -> putString(key, value)
                    is Boolean -> putBoolean(key, value)
                }
            }
        require(method == "apply" || method == "commit")
        val request = requireNotNull(extras)
        val edit = preferences.edit()
        if (request.getBoolean("clear")) edit.clear()
        for (key in request.getStringArrayList("removed").orEmpty()) edit.remove(key)
        val values = requireNotNull(request.getBundle("values"))
        for (key in values.keySet()) when (val value = values.get(key)) {
            is String -> edit.putString(key, value)
            is Boolean -> edit.putBoolean(key, value)
            else -> error("Unsupported preference type")
        }
        val saved =
            if (method == "commit") edit.commit()
            else {
                edit.apply()
                true
            }
        return Bundle().apply { putBoolean("saved", saved) }
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ) = 0
}
