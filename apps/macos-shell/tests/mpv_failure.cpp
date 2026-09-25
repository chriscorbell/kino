// macOS dyld interposition makes libmpv refuse to start, so the test drives the
// same failure a broken install or a rejected option would. Linked only by the
// test; KINO_TEST_MPV_FAILURE names the call that fails.
#include <mpv/client.h>
#include <mpv/render.h>

#include <atomic>
#include <cstdlib>
#include <cstring>

namespace {
std::atomic<int> renderContextsRequested = 0;

bool failing(const char *stage) {
    const char *value = std::getenv("KINO_TEST_MPV_FAILURE");
    return value && std::strcmp(value, stage) == 0;
}

mpv_handle *failingCreate() {
    return failing("create") ? nullptr : mpv_create();
}

int failingInitialize(mpv_handle *core) {
    return failing("initialize") ? MPV_ERROR_UNSUPPORTED : mpv_initialize(core);
}

int countedRenderCreate(mpv_render_context **out, mpv_handle *core, mpv_render_param *params) {
    ++renderContextsRequested;
    return mpv_render_context_create(out, core, params);
}
} // namespace

extern "C" int kino_test_render_contexts_requested() { return renderContextsRequested.load(); }

#define INTERPOSE(replacement, replacee) \
    __attribute__((used)) static struct { const void *newFunction; const void *oldFunction; } \
    interpose_##replacee __attribute__((section("__DATA,__interpose"))) = \
    {reinterpret_cast<const void *>(replacement), reinterpret_cast<const void *>(replacee)};
INTERPOSE(failingCreate, mpv_create)
INTERPOSE(failingInitialize, mpv_initialize)
INTERPOSE(countedRenderCreate, mpv_render_context_create)
