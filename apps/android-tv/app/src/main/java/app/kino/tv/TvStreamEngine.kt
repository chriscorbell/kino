package app.kino.tv

import android.content.Context
import android.util.Base64
import android.util.Log
import com.stremio.core.types.resource.Stream
import java.io.File
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/*
 * Kino's torrent engine on the TV: the same kino-stream-engine the Mac runs, built for Android and
 * shipped as a native library so Android extracts it executable. It runs as a child process with
 * the Mac's contract: an authenticated loopback URL on stdout, sanitized logs on stderr, and a
 * clean shutdown when stdin closes (ADR 0015). Each Kino process, guest or account, runs its own
 * engine on demand, with its own cache.
 */

internal class TorrentUnavailable(message: String) : Exception(message)

internal class TvStreamEngine(private val context: Context, private val profile: String) {
    private val mutex = Mutex()
    private var process: Process? = null
    private var address: String? = null
    private val client = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build()

    val cacheDirectory
        get() = File(context.cacheDir, "engine-$profile")

    private val binary
        get() = File(context.applicationInfo.nativeLibraryDir, "libkino_stream_engine.so")

    /** The engine's authenticated base URL, starting it if needed. */
    suspend fun url(): String =
        mutex.withLock {
            address?.takeIf { process?.isAlive == true } ?: withContext(Dispatchers.IO) { start() }
        }

    private suspend fun start(): String {
        if (!binary.canExecute()) throw TorrentUnavailable("engine missing")
        val config = File(context.noBackupFilesDir, "engine-$profile").apply { mkdirs() }
        cacheDirectory.mkdirs()
        val builder = ProcessBuilder(binary.path)
        builder.environment().apply {
            put("KINO_ENGINE_CONFIG_DIR", config.path)
            put("KINO_ENGINE_CACHE_DIR", cacheDirectory.path)
            // No browser talks to the engine here; requests from Media3 and OkHttp carry no Origin.
            put("KINO_ENGINE_UI_ORIGIN", "null")
            // Both libtorrent's OpenSSL and the engine's own HTTPS requests read Android's roots here.
            put("SSL_CERT_FILE", systemRoots(context, profile).path)
        }
        val started = builder.start()
        process = started
        // Engine logs are already sanitized to stable event names and fields.
        Thread({
                // The stream ends, or fails, when the engine exits or is killed; either way the
                // log is done, and nothing here may take the app down with it.
                runCatching {
                    started.errorStream.bufferedReader().forEachLine {
                        Log.i("KinoEngine", it.removePrefix("KINO_ENGINE_LOG "))
                    }
                }
            }, "kino-engine-log")
            .apply { isDaemon = true }
            .start()
        val ready =
            try {
                withTimeout(30_000) {
                    runInterruptible {
                        started.inputStream.bufferedReader().lineSequence().firstOrNull {
                            it.startsWith("KINO_ENGINE_READY ")
                        }
                    }
                }
            } catch (e: Exception) {
                stop()
                throw TorrentUnavailable("engine did not start")
            }
                ?: run {
                    stop()
                    throw TorrentUnavailable("engine exited")
                }
        // This capability never goes to logs, Core, or storage; it changes with every start.
        return ready.removePrefix("KINO_ENGINE_READY ").trim().also { address = it }
    }

    /**
     * Closes stdin, the engine's graceful stop, then kills it if it does not exit in time: its
     * server waits for open connections, which a player's pool can hold for minutes. Either way the
     * engine has stopped once this returns true, so its files may go.
     */
    fun stop(): Boolean {
        val running = process ?: return true
        process = null
        address = null
        runCatching { running.outputStream.close() }
        if (!running.waitFor(5, TimeUnit.SECONDS)) {
            running.destroyForcibly()
            running.waitFor(2, TimeUnit.SECONDS)
        }
        return !running.isAlive
    }

    /** Stops the engine off the main thread, when no one is watching. */
    fun stopInBackground() {
        if (process == null) return
        Thread({ runCatching { kotlinx.coroutines.runBlocking { mutex.withLock { stop() } } } }, "kino-engine-stop").start()
    }

    /** Stops the engine and deletes its downloads, but only once it has exited. */
    suspend fun clearCache(): Boolean =
        mutex.withLock {
            withContext(Dispatchers.IO) {
                if (!stop()) return@withContext false
                cacheDirectory.deleteRecursively()
            }
        }

    /**
     * The media URL Media3 plays for a torrent source, following the desktop client: create the
     * torrent with the source's trackers, then read the chosen file, the one Core named or the one
     * the engine guesses is the video.
     */
    suspend fun mediaUrl(torrent: Stream.Tramvai): String {
        val base = url()
        val infoHash = torrent.infoHash.lowercase()
        val trackers =
            torrent.announce
                .map { it.removePrefix("tracker:") }
                .filter { Regex("^(https?|udp)://").containsMatchIn(it) }
                .distinct()
        val body =
            JSONObject()
                .put("peerSearch", JSONObject().put("sources", JSONArray(trackers)))
                .put("guessFileIdx", torrent.fileIdx == null)
        val stats =
            withContext(Dispatchers.IO) {
                client
                    .newCall(
                        Request.Builder()
                            .url("$base/$infoHash/create")
                            .post(body.toString().toRequestBody("application/json".toMediaType()))
                            .build()
                    )
                    .execute()
                    .use { response ->
                        if (!response.isSuccessful) throw TorrentUnavailable("create failed")
                        JSONObject(checkNotNull(response.body).string())
                    }
            }
        val index =
            torrent.fileIdx?.takeIf { it >= 0 }
                ?: stats.optInt("guessedFileIdx", -1).takeIf { it >= 0 }
                ?: throw TorrentUnavailable("no playable file")
        return "$base/$infoHash/$index"
    }
}

/**
 * Android's system roots as one PEM file. The engine runs outside any JVM, so it cannot ask
 * Android's trust manager; the system store is what a Kino request would trust anyway. User-added
 * authorities are left out, as Android leaves them out for apps.
 */
internal fun systemRoots(context: Context, profile: String): File {
    val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
    val pem = StringBuilder()
    for (alias in store.aliases()) {
        if (!alias.startsWith("system:")) continue
        val certificate = store.getCertificate(alias) as? X509Certificate ?: continue
        pem.append("-----BEGIN CERTIFICATE-----\n")
        pem.append(Base64.encodeToString(certificate.encoded, Base64.DEFAULT))
        pem.append("-----END CERTIFICATE-----\n")
    }
    return File(context.noBackupFilesDir, "engine-roots-$profile.pem").apply { writeText(pem.toString()) }
}
