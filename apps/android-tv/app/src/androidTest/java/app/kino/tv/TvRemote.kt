package app.kino.tv

import android.app.Instrumentation
import android.os.SystemClock
import android.view.KeyEvent
import android.view.ViewConfiguration
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

    /**
     * Holds [code] past the long-press timeout, as a person holding select does. A held remote
     * key repeats, and TV Material reads the repeat as the long press.
     */
    fun hold(code: Int) {
        val down = SystemClock.uptimeMillis()
        instrumentation.sendKeySync(KeyEvent(down, down, KeyEvent.ACTION_DOWN, code, 0))
        Thread.sleep(ViewConfiguration.getLongPressTimeout().toLong())
        val held = SystemClock.uptimeMillis()
        instrumentation.sendKeySync(
            KeyEvent(down, held, KeyEvent.ACTION_DOWN, code, 1, 0, -1, 0, KeyEvent.FLAG_LONG_PRESS)
        )
        instrumentation.sendKeySync(
            KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0)
        )
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

    /**
     * Whether focus is on the control labelled [text], whichever node carries the label: the
     * focused node itself, one of its descendants, or an ancestor.
     */
    fun focusedOn(text: String): Boolean {
        fun labelled(node: AccessibilityNodeInfo): Boolean =
            node.text?.contains(text) == true || node.contentDescription?.contains(text) == true
        fun inside(node: AccessibilityNodeInfo): Boolean =
            labelled(node) || (0 until node.childCount).any { node.getChild(it)?.let(::inside) == true }
        val focusedNode = visible().firstOrNull { it.isFocused } ?: return false
        return inside(focusedNode) || node(text)?.let(::focused) == true
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
