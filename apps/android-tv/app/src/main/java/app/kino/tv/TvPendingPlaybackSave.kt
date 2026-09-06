package app.kino.tv

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The process retains an interrupted screen's save until it succeeds or can be retried. */
internal class TvPendingPlaybackSave {
    enum class Status {
        Idle,
        Saving,
        Failed,
    }

    private val mutable = MutableStateFlow(Status.Idle)
    val status = mutable.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var pending: TvPlaybackShutdown? = null
    private var task: Job? = null

    fun retain(shutdown: TvPlaybackShutdown, previous: Job?, release: () -> Unit) {
        check(pending == null)
        pending = shutdown
        mutable.value = Status.Saving
        task =
            scope.launch {
                try {
                    previous?.join()
                    complete(shutdown.finish(retry = true))
                } finally {
                    shutdown.detach()
                    release()
                }
            }
    }

    fun retry() {
        val shutdown = pending ?: return
        if (task?.isActive == true) return
        mutable.value = Status.Saving
        task = scope.launch { complete(shutdown.finish(retry = true)) }
    }

    private fun complete(saved: Boolean) {
        if (saved) pending = null
        mutable.value = if (saved) Status.Idle else Status.Failed
    }
}
