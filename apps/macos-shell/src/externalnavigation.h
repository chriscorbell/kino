#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

class ExternalNavigation : public QObject {
    Q_OBJECT
    QML_ELEMENT
public:
    using QObject::QObject;
    Q_INVOKABLE bool openUrl(const QString &value);
};
