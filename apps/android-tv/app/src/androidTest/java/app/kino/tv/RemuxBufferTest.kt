package app.kino.tv

import android.content.Intent
import android.os.ParcelFileDescriptor
import android.util.Log
import android.view.SurfaceView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.LoadControl
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * How far ahead a heavy remux buffers. A 60 Mbps stream outgrows Media3's default buffer, and
 * Kino's buffer, sized from the large heap, holds all 30 seconds of it.
 */
class RemuxBufferTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun aSixtyMegabitRemuxBuffersFurtherThanMediaThreesDefault() {
        assertTrue(
            "The manifest's large heap applies: ${Runtime.getRuntime().maxMemory() shr 20} MB",
            Runtime.getRuntime().maxMemory() >= 384L shl 20,
        )
        // pnpm android:check pushes the fixture here; it is too large for the test APK.
        val file = File(context.cacheDir, "remux-60mbps.mp4")
        instrumentation.uiAutomation
            .executeShellCommand("cat /data/local/tmp/kino-remux-60mbps.mp4")
            .let(ParcelFileDescriptor::AutoCloseInputStream)
            .use { input -> file.outputStream().use { input.copyTo(it, 1 shl 20) } }
        try {
            assertTrue(
                "The remux fixture is missing; run pnpm android:check",
                file.length() > 200L shl 20,
            )
            val default = bufferedAhead(file, DefaultLoadControl())
            assertTrue(
                "The fixture outgrows Media3's default buffer, which held ${default} ms",
                default < 22_000,
            )
            val kino = bufferedAhead(file, kinoLoadControl())
            Log.i("KinoRemuxBuffer", "buffered_ahead default_ms=$default kino_ms=$kino")
            assertTrue("Kino's buffer holds the whole remux, not ${kino} ms", kino >= 29_000)
        } finally {
            file.delete()
        }
    }

    /**
     * Prepares [file] paused and reads how far ahead it buffered once loading stops. The file is
     * served over loopback HTTP, since Media3 buffers a `file:` URI as local playback, with a
     * one-second target of its own.
     */
    private fun bufferedAhead(file: File, loadControl: LoadControl): Long {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val url = "http://127.0.0.1:${server.localPort}/remux.mp4"
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val connection = runCatching { server.accept() }.getOrNull() ?: break
                thread(isDaemon = true) { runCatching { connection.use { send(it, file) } } }
            }
        }
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        var player: ExoPlayer? = null
        try {
            instrumentation.runOnMainSync {
                val surface = SurfaceView(activity)
                activity.setContentView(surface)
                player =
                    createTvPlayer(activity, HardwareRenderers(activity), loadControl = loadControl)
                        .apply {
                            setVideoSurfaceView(surface)
                            setMediaItem(MediaItem.fromUri(url))
                            prepare()
                        }
            }
            // Loopback serves as fast as the device reads, so loading stops only where the buffer
            // is full or the file ends.
            val deadline = System.currentTimeMillis() + 30_000
            var quiet = 0
            var ahead = 0L
            while (System.currentTimeMillis() < deadline && quiet < 10) {
                Thread.sleep(100)
                var loading = true
                instrumentation.runOnMainSync {
                    loading = player!!.isLoading
                    ahead = player!!.totalBufferedDuration
                }
                quiet = if (!loading && ahead > 0) quiet + 1 else 0
            }
            return ahead
        } finally {
            instrumentation.runOnMainSync {
                player?.release()
                activity.finish()
            }
            server.close()
            // The next player's buffer should not share the heap with this one's.
            Runtime.getRuntime().gc()
        }
    }

    /** Answers one request for [file], from the start of its range to the end. */
    private fun send(client: Socket, file: File) {
        val input = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
        input.readLine() ?: return
        var start = 0L
        var ranged = false
        while (true) {
            val line = input.readLine() ?: break
            if (line.isEmpty()) break
            Regex("(?i)^range: bytes=(\\d+)-").find(line)?.let {
                start = it.groupValues[1].toLong()
                ranged = true
            }
        }
        val size = file.length()
        val out = client.getOutputStream()
        out.write(
            buildString {
                    append(if (ranged) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                    append("Content-Type: video/mp4\r\nAccept-Ranges: bytes\r\n")
                    append("Content-Length: ${size - start}\r\n")
                    if (ranged) append("Content-Range: bytes $start-${size - 1}/$size\r\n")
                    append("Connection: close\r\n\r\n")
                }
                .toByteArray()
        )
        file.inputStream().use { data ->
            data.skip(start)
            data.copyTo(out, 1 shl 16)
        }
    }
}
