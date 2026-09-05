// macOS dyld interposition checks the real libmpv calls before invalid cleanup
// can invoke undefined behavior. This library is linked only by the test.
#include <mpv/client.h>
#include <mpv/render.h>
#include <OpenGL/OpenGL.h>
#include <pthread.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <unordered_map>

namespace {
struct Context {
    CGLContextObj gl;
    pthread_t thread;
    mpv_handle *core;
    bool callback = false;
};
std::mutex stateMutex;
std::unordered_map<mpv_render_context *, Context> contexts;
std::unordered_map<mpv_handle *, bool> wakeups;
std::atomic<int> created = 0, freed = 0, destroyed = 0;

[[noreturn]] void violation(const char *reason) {
    std::fprintf(stderr, "KINO_RENDER_LIFETIME_FAILURE %s\n", reason);
    std::fflush(stderr);
    std::_Exit(86);
}

Context &checkedContext(mpv_render_context *context) {
    auto it = contexts.find(context);
    if (it == contexts.end()) violation("unknown-context");
    if (CGLGetCurrentContext() != it->second.gl) violation("wrong-current-context");
    if (!pthread_equal(pthread_self(), it->second.thread)) violation("wrong-thread");
    return it->second;
}

int checkedCreate(mpv_render_context **out, mpv_handle *core, mpv_render_param *params) {
    int result = mpv_render_context_create(out, core, params);
    if (result >= 0) {
        std::lock_guard lock(stateMutex);
        if (!CGLGetCurrentContext()) violation("create-without-current-context");
        contexts[*out] = {CGLGetCurrentContext(), pthread_self(), core};
        ++created;
    }
    return result;
}

void checkedCallback(mpv_render_context *context, mpv_render_update_fn callback, void *data) {
    {
        std::lock_guard lock(stateMutex);
        checkedContext(context).callback = callback != nullptr;
    }
    mpv_render_context_set_update_callback(context, callback, data);
}

uint64_t checkedUpdate(mpv_render_context *context) {
    {
        std::lock_guard lock(stateMutex);
        checkedContext(context);
    }
    return mpv_render_context_update(context);
}

int checkedRender(mpv_render_context *context, mpv_render_param *params) {
    {
        std::lock_guard lock(stateMutex);
        checkedContext(context);
    }
    return mpv_render_context_render(context, params);
}

void checkedFree(mpv_render_context *context) {
    {
        std::lock_guard lock(stateMutex);
        if (checkedContext(context).callback) violation("render-callback-still-attached");
        contexts.erase(context);
    }
    mpv_render_context_free(context);
    ++freed;
}

void checkedWakeup(mpv_handle *core, void (*callback)(void *), void *data) {
    {
        std::lock_guard lock(stateMutex);
        wakeups[core] = callback != nullptr;
    }
    mpv_set_wakeup_callback(core, callback, data);
}

void checkedDestroy(mpv_handle *core) {
    {
        std::lock_guard lock(stateMutex);
        for (const auto &[_, context] : contexts) {
            if (context.core == core) violation("core-destroyed-before-render-context");
        }
        if (wakeups[core]) violation("wakeup-callback-still-attached");
        wakeups.erase(core);
    }
    mpv_terminate_destroy(core);
    ++destroyed;
}
} // namespace

extern "C" int kino_render_contexts_created() { return created.load(); }
extern "C" int kino_render_contexts_freed() { return freed.load(); }
extern "C" int kino_render_cores_destroyed() { return destroyed.load(); }

#define INTERPOSE(replacement, replacee) \
    __attribute__((used)) static struct { const void *newFunction; const void *oldFunction; } \
    interpose_##replacee __attribute__((section("__DATA,__interpose"))) = \
    {reinterpret_cast<const void *>(replacement), reinterpret_cast<const void *>(replacee)};
INTERPOSE(checkedCreate, mpv_render_context_create)
INTERPOSE(checkedCallback, mpv_render_context_set_update_callback)
INTERPOSE(checkedUpdate, mpv_render_context_update)
INTERPOSE(checkedRender, mpv_render_context_render)
INTERPOSE(checkedFree, mpv_render_context_free)
INTERPOSE(checkedWakeup, mpv_set_wakeup_callback)
INTERPOSE(checkedDestroy, mpv_terminate_destroy)
