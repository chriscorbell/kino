#pragma once

#include <QLocalServer>
#include <QObject>
#include <QString>

// One Kino per user profile. A second launch finds the first through a local
// socket named from the app-data path, asks it to come forward, and exits, so
// two processes never write the same profile and Core storage.
class SingleInstance : public QObject {
    Q_OBJECT
public:
    // name defaults to one derived from the app-data directory.
    explicit SingleInstance(QString name = {}, QObject *parent = nullptr);

    // False when another instance holds the name; it has been asked to come
    // forward, and this one should exit.
    bool claim();

signals:
    void activationRequested();

private:
    QString name_;
    QLocalServer server_;
};
