package app.kino.tv

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import com.stremio.core.Core
import com.stremio.core.Field
import com.stremio.core.Storage
import com.stremio.core.models.Ctx
import com.stremio.core.runtime.msg.*
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ControlledCoreStorage(private val delegate: Storage) : Storage {
    @Volatile var beforeWrite: ((String, String?) -> Storage.Result<Unit>?)? = null

    override fun get(key: String) = delegate.get(key)

    override fun set(key: String, value: String?): Storage.Result<Unit> =
        beforeWrite?.invoke(key, value) ?: delegate.set(key, value)
}

class PersistenceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Test
    fun libraryPutsWaitForFullBodiesAndUnrelatedGetsDoNotBlockTheDrain() = runBlocking {
        val app = context.applicationContext as ShieldTestApplication
        instrumentation.runOnMainSync { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val activity =
            instrumentation.startActivitySync(
                Intent(context, PlaybackProbeActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ) as PlaybackProbeActivity
        try {
            HeldResponse().use { response ->
                activity.requestPersistenceFixture(response.port, true, 500)
                val pending = async(Dispatchers.IO) { Core.drainWrites() }
                delay(150)
                assertFalse(
                    "A scheduled put is pending before its future starts",
                    pending.isCompleted,
                )
                assertTrue(response.headersSent.await(5, TimeUnit.SECONDS))
                delay(100)
                assertFalse("Response headers are not a completed library put", pending.isCompleted)
                response.release.countDown()
                assertTrue(pending.await())
                assertEquals("POST", response.method.get())
            }
            HeldResponse().use { response ->
                activity.requestPersistenceFixture(response.port, false, 0)
                assertTrue(response.headersSent.await(5, TimeUnit.SECONDS))
                assertTrue(withTimeout(500) { Core.drainWrites() })
                assertEquals("GET", response.method.get())
            }
            HeldResponse(status = 503).use { response ->
                activity.requestPersistenceFixture(response.port, true, 0)
                assertTrue(response.headersSent.await(5, TimeUnit.SECONDS))
                response.release.countDown()
                assertTrue(
                    "A failed account request preserves locally saved progress",
                    Core.drainWrites(),
                )
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    fun queuedSnapshotsFinishInOrderAndFailedWritesRetryWithoutAnotherAction() = runBlocking {
        val app = context.applicationContext as ShieldTestApplication
        instrumentation.runOnMainSync { app.core.initialize() }
        assertTrue(Core.drainWrites())
        val original = Core.getState<Ctx>(Field.CTX).profile.settings
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val writes = Collections.synchronizedList(mutableListOf<String>())
        fun update(language: String) {
            instrumentation.runOnMainSync {
                val latest = Core.getState<Ctx>(Field.CTX).profile.settings
                Core.dispatch(
                    Action(
                        Action.Type.Ctx(
                            ActionCtx(
                                ActionCtx.Args.UpdateSettings(latest.copy(audioLanguage = language))
                            )
                        )
                    ),
                    Field.CTX,
                )
            }
        }
        fun savedLanguage(): String {
            val result = app.storage.get("profile") as Storage.Result.Ok
            return JSONObject(result.value!!).getJSONObject("settings").getString("audioLanguage")
        }
        try {
            app.storage.beforeWrite = { key, value ->
                if (key == "profile") {
                    val language =
                        JSONObject(value!!).getJSONObject("settings").getString("audioLanguage")
                    writes += language
                    if (language == "spa") {
                        entered.countDown()
                        check(release.await(10, TimeUnit.SECONDS))
                    }
                }
                null
            }
            update("spa")
            assertTrue("The actual storage callback must begin", entered.await(5, TimeUnit.SECONDS))
            update("fre")
            val pending = async(Dispatchers.IO) { Core.drainWrites() }
            delay(400)
            assertFalse(
                "Dispatch completion must not release a pending durable write",
                pending.isCompleted,
            )
            assertEquals(listOf("spa"), writes.toList())
            release.countDown()
            assertTrue(pending.await())
            assertEquals(listOf("spa", "fre"), writes.toList())
            assertEquals("fre", savedLanguage())

            app.storage.beforeWrite = { key, _ ->
                if (key == "profile") Storage.Result.Err("Fixture write failure") else null
            }
            update("ger")
            assertFalse(Core.drainWrites())
            assertEquals(
                "Core memory alone cannot establish durability",
                "ger",
                Core.getState<Ctx>(Field.CTX).profile.settings.audioLanguage,
            )
            assertEquals("fre", savedLanguage())
            app.storage.beforeWrite = null
            assertTrue(
                "Retry persists the retained snapshot without a new Core action",
                Core.drainWrites(retry = true),
            )
            assertEquals("ger", savedLanguage())
        } finally {
            release.countDown()
            app.storage.beforeWrite = null
            Core.drainWrites(retry = true)
            instrumentation.runOnMainSync {
                Core.dispatch(
                    Action(Action.Type.Ctx(ActionCtx(ActionCtx.Args.UpdateSettings(original)))),
                    Field.CTX,
                )
            }
            assertTrue(Core.drainWrites())
        }
    }
}

private class HeldResponse(private val status: Int = 200) : AutoCloseable {
    private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val port = server.localPort
    val headersSent = CountDownLatch(1)
    val release = CountDownLatch(1)
    val method = AtomicReference<String>()
    private val failure = AtomicReference<Throwable>()
    private val thread =
        Thread {
                try {
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
                        method.set(reader.readLine().substringBefore(' '))
                        var length = 0
                        while (true) {
                            val line = reader.readLine() ?: error("Missing fixture request headers")
                            if (line.isEmpty()) break
                            if (line.startsWith("Content-Length:", ignoreCase = true))
                                length = line.substringAfter(':').trim().toInt()
                        }
                        repeat(length) { check(reader.read() != -1) }
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 $status Fixture\r\nContent-Type: application/json\r\n" +
                                    "Content-Length: 2\r\nConnection: close\r\n\r\n{")
                                .toByteArray(Charsets.US_ASCII)
                        )
                        output.flush()
                        headersSent.countDown()
                        check(release.await(5, TimeUnit.SECONDS))
                        output.write('}'.code)
                        output.flush()
                    }
                } catch (error: Throwable) {
                    failure.set(error)
                }
            }
            .apply { start() }

    override fun close() {
        release.countDown()
        thread.join(6000)
        server.close()
        check(!thread.isAlive) { "Fixture response did not finish" }
        failure.get()?.let { throw AssertionError("Fixture response failed", it) }
    }
}
