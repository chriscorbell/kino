#include "closecoordinator.h"

#include <QCoreApplication>
#include <QEvent>

CloseCoordinator::CloseCoordinator(QObject *parent) : QObject(parent) {
    QCoreApplication::instance()->installEventFilter(this);
    timeout_.setSingleShot(true);
    // KINO_CLOSE_TIMEOUT_MS shortens the deadline for fixtures.
    bool configured = false;
    const int timeout = qEnvironmentVariableIntValue("KINO_CLOSE_TIMEOUT_MS", &configured);
    timeout_.setInterval(configured && timeout > 0 ? timeout : 15000);
    connect(&timeout_, &QTimer::timeout, this, [this]() {
        pending_ = false;
        unanswered_ = true;
        qWarning("[kino:shutdown] save acknowledgement timed out; window kept open");
    });
}

void CloseCoordinator::setReady(bool ready) {
    if (ready_ == ready) return;
    ready_ = ready;
    emit readyChanged();
}

bool CloseCoordinator::requestClose() {
    // An interface that let a save request time out is not answering. Asking
    // again closes rather than leaving a window the user cannot quit.
    if (approved_ || !ready_) return true;
    if (unanswered_) {
        qWarning("[kino:shutdown] closing after an unanswered save request");
        return true;
    }
    if (!pending_) {
        pending_ = true;
        timeout_.start();
        emit closeRequested(++requestId_);
    }
    return false;
}

void CloseCoordinator::acknowledgeClose(int requestId, bool saved) {
    if (!pending_ || requestId != requestId_) return;
    pending_ = false;
    unanswered_ = false;
    timeout_.stop();
    if (!saved) {
        qWarning("[kino:shutdown] progress save failed; window kept open");
        return;
    }
    approved_ = true;
    emit closeApproved();
}

void CloseCoordinator::interfaceLost() {
    // The web process holds Core and the save sequence. Once it is gone
    // nothing can acknowledge a save, so a pending close proceeds and later
    // ones are not held until the reloaded interface reports ready again.
    const bool wasPending = pending_;
    pending_ = false;
    unanswered_ = false;
    timeout_.stop();
    setReady(false);
    if (wasPending) {
        approved_ = true;
        emit closeApproved();
    }
}

bool CloseCoordinator::eventFilter(QObject *watched, QEvent *event) {
    if (watched == QCoreApplication::instance() && event->type() == QEvent::Quit) {
        return !requestClose();
    }
    return QObject::eventFilter(watched, event);
}
