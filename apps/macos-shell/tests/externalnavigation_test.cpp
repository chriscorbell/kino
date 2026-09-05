#include "externalnavigation.h"

#include <QDesktopServices>
#include <QTest>
#include <QUrl>

class ExternalNavigationTest : public QObject {
    Q_OBJECT
private slots:
    void rejectsNonWebDestinations() {
        ExternalNavigation navigation;
        for (const QString &value : {QString(), QStringLiteral("relative/path"),
                 QStringLiteral("file:///tmp/document.html"), QStringLiteral("javascript:alert(1)"),
                 QStringLiteral("stremio://addon.invalid/manifest.json"),
                 QStringLiteral("https://user:secret@addon.invalid/configure"),
                 QStringLiteral("https:///configure"), QStringLiteral("https://bad host/configure")}) {
            QVERIFY(!navigation.openUrl(value));
        }
    }

    void opensWebDestinationsThroughTheSystemHandler() {
        QDesktopServices::setUrlHandler(QStringLiteral("https"), this, "captureUrl");
        QDesktopServices::setUrlHandler(QStringLiteral("http"), this, "captureUrl");
        ExternalNavigation navigation;
        const QStringList values{QStringLiteral("https://addon.invalid/configuration/configure"),
                                 QStringLiteral("http://127.0.0.1:7000/configure")};
        for (const QString &value : values) {
            QVERIFY(navigation.openUrl(value));
            QCOMPARE(captured, QUrl(value));
        }
        QDesktopServices::unsetUrlHandler(QStringLiteral("https"));
        QDesktopServices::unsetUrlHandler(QStringLiteral("http"));
    }

public slots:
    void captureUrl(const QUrl &url) { captured = url; }

private:
    QUrl captured;
};

QTEST_MAIN(ExternalNavigationTest)
#include "externalnavigation_test.moc"
