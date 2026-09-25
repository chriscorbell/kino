package app.kino.tv

import android.app.Instrumentation
import android.view.accessibility.AccessibilityNodeInfo
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

/**
 * Remote keys and accessibility reads against the real window, for gates that drive the TV
 * presentation the way a person with a remote does.
 */
internal class TvRemote(private val instrumentation: Instrumentation) {
    fun key(code: Int) {
        instrumentation.sendKeyDownUpSync(code)
        instrumentation.waitForIdleSync()
        Thread.sleep(80)
    }

    private fun nodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> =
        listOf(root) +
            (0 until root.childCount).flatMap { root.getChild(it)?.let(::nodes).orEmpty() }

    fun visible(): List<AccessibilityNodeInfo> =
        instrumentation.uiAutomation.rootInActiveWindow
            ?.let(::nodes)
            ?.filter { it.isVisibleToUser }
            .orEmpty()

    fun node(text: String) =
        visible().firstOrNull {
            it.text?.contains(text) == true || it.contentDescription?.contains(text) == true
        }

    fun focused(node: AccessibilityNodeInfo): Boolean {
        var target: AccessibilityNodeInfo? = node
        while (target != null) {
            if (target.isFocused) return true
            target = target.parent
        }
        return false
    }

    fun focusedLabel(): String =
        visible()
            .firstOrNull { it.isFocused }
            ?.let { it.contentDescription ?: it.text ?: "" }
            ?.toString()
            .orEmpty()

    fun focus(text: String) {
        var target = node(text) ?: error("Missing control: $text")
        while (!target.isFocusable && target.parent != null) target = target.parent
        assertTrue(
            "Control accepts remote focus: $text",
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS),
        )
        instrumentation.waitForIdleSync()
    }

    fun waitFor(text: String, timeoutMs: Long = 10_000) =
        waitUntil("Missing visible text: $text", timeoutMs) { node(text) != null }

    fun waitUntil(reason: String, timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            instrumentation.waitForIdleSync()
            if (condition()) return
            Thread.sleep(100)
        }
        fail(
            reason +
                " Visible nodes: " +
                visible().mapNotNull { it.text ?: it.contentDescription }.joinToString(" | ")
        )
    }

    /** Presses [code] until [condition] holds, up to [limit] presses. */
    fun pressUntil(code: Int, reason: String, limit: Int = 80, condition: () -> Boolean) {
        repeat(limit) {
            if (condition()) return
            key(code)
        }
        waitUntil(reason, 3_000, condition)
    }
}
