#include "sleepobserver.h"

#include <QAbstractNativeEventFilter>
#include <QCoreApplication>
#include <QSet>
#include <windows.h>

namespace {

// Windows broadcasts WM_POWERBROADCAST with PBT_APMSUSPEND to every top-level
// window just before it suspends, and Qt passes it through its native event
// filters on the main thread.
class SuspendFilter : public QAbstractNativeEventFilter {
public:
    explicit SuspendFilter(std::function<void()> willSleep) : willSleep_(std::move(willSleep)) {}

    bool nativeEventFilter(const QByteArray &type, void *message, qintptr *) override {
        if (type != "windows_generic_MSG") return false;
        const MSG *msg = static_cast<const MSG *>(message);
        if (msg->message == WM_POWERBROADCAST && msg->wParam == PBT_APMSUSPEND) willSleep_();
        return false;
    }

    void deliver() { willSleep_(); }

private:
    std::function<void()> willSleep_;
};

QSet<SuspendFilter *> &observers() {
    static QSet<SuspendFilter *> live;
    return live;
}

} // namespace

SleepObserver::SleepObserver(std::function<void()> willSleep) {
    auto *filter = new SuspendFilter(std::move(willSleep));
    QCoreApplication::instance()->installNativeEventFilter(filter);
    observers().insert(filter);
    token_ = filter;
}

SleepObserver::~SleepObserver() {
    auto *filter = static_cast<SuspendFilter *>(token_);
    observers().remove(filter);
    if (auto *app = QCoreApplication::instance()) app->removeNativeEventFilter(filter);
    delete filter;
}

void SleepObserver::readyToSleep() {}

void postWillSleepForProbe() {
    for (SuspendFilter *filter : observers()) filter->deliver();
}
