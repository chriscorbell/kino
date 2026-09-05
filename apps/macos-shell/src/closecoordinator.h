#pragma once

#include <QObject>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

class CloseCoordinator : public QObject {
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool ready READ ready WRITE setReady NOTIFY readyChanged)
public:
    explicit CloseCoordinator(QObject *parent = nullptr);
    bool ready() const { return ready_; }
    Q_INVOKABLE void setReady(bool ready);
    Q_INVOKABLE bool requestClose();
    Q_INVOKABLE void acknowledgeClose(int requestId, bool saved);

signals:
    void readyChanged();
    void closeRequested(int requestId);
    void closeApproved();

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    bool ready_ = false;
    bool pending_ = false;
    bool approved_ = false;
    int requestId_ = 0;
    QTimer timeout_;
};
