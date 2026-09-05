#include "closecoordinator.h"

#include <QCoreApplication>
#include <QEvent>

CloseCoordinator::CloseCoordinator(QObject *parent) : QObject(parent) {
    QCoreApplication::instance()->installEventFilter(this);
    timeout_.setSingleShot(true);
    timeout_.setInterval(15000);
    connect(&timeout_, &QTimer::timeout, this, [this]() {
        pending_ = false;
        qWarning("[kino:shutdown] save acknowledgement timed out; window kept open");
    });
}

void CloseCoordinator::setReady(bool ready) {
    if (ready_ == ready) return;
    ready_ = ready;
    emit readyChanged();
}

bool CloseCoordinator::requestClose() {
    if (approved_ || !ready_) return true;
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
    timeout_.stop();
    if (!saved) {
        qWarning("[kino:shutdown] progress save failed; window kept open");
        return;
    }
    approved_ = true;
    emit closeApproved();
}

bool CloseCoordinator::eventFilter(QObject *watched, QEvent *event) {
    if (watched == QCoreApplication::instance() && event->type() == QEvent::Quit) {
        return !requestClose();
    }
    return QObject::eventFilter(watched, event);
}
