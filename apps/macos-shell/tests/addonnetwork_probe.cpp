#include "addonnetwork.h"

#include <QCoreApplication>
#include <QFile>
#include <QFutureWatcher>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSslCertificate>
#include <QSslConfiguration>

#include <cstdio>

// The fixture CA is trusted only in this test executable.
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    if (argc < 3) return 1;
    QFile certificate(QString::fromLocal8Bit(argv[1]));
    if (!certificate.open(QIODevice::ReadOnly)) return 1;
    auto tls = QSslConfiguration::defaultConfiguration();
    tls.addCaCertificates(QSslCertificate::fromData(certificate.readAll()));
    QSslConfiguration::setDefaultConfiguration(tls);

    AddonNetwork network;
    QJsonArray results;
    int next = 2;
    QFutureWatcher<QVariantMap> watcher;
    QObject::connect(&watcher, &QFutureWatcher<QVariantMap>::finished, &app, [&]() {
        results.append(QJsonObject::fromVariantMap(watcher.result()));
        if (next < argc) watcher.setFuture(network.get(QString::fromLocal8Bit(argv[next++])));
        else {
            std::puts(QJsonDocument(results).toJson(QJsonDocument::Compact).constData());
            app.quit();
        }
    });
    watcher.setFuture(network.get(QString::fromLocal8Bit(argv[next++])));
    return app.exec();
}
