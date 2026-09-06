package app.kino.tv

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A benchmark-only pipe holds EOF until the real player has prepared an unknown-duration stream.
 */
class EndingFixtureProvider : ContentProvider() {
    private var finished = CountDownLatch(1)

    override fun onCreate() = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        when (method) {
            "reset" -> finished = CountDownLatch(1)
            "finish" -> finished.countDown()
            else -> error("Unknown fixture operation")
        }
        return Bundle.EMPTY
    }

    override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
        check(uri.lastPathSegment == "unknown.ts" && mode == "r")
        val pipe = ParcelFileDescriptor.createPipe()
        val complete = finished
        Thread {
                try {
                    ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { output ->
                        File(requireNotNull(context).cacheDir, "up-next-unknown.ts")
                            .inputStream()
                            .use { it.copyTo(output) }
                        complete.await(10, TimeUnit.SECONDS)
                    }
                } catch (_: java.io.IOException) {
                    // Closing playback can close the read end before the fixture finishes writing.
                }
            }
            .start()
        return AssetFileDescriptor(pipe[0], 0, AssetFileDescriptor.UNKNOWN_LENGTH)
    }

    override fun getType(uri: Uri) = "video/mp2t"

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ) = 0
}
