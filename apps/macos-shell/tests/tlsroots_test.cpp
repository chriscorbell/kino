#include "tlsroots.h"

#include <QDir>
#include <QFile>
#include <QSslCertificate>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QtTest>

namespace {

// A throwaway authority, public by design, standing in for a fixture's root.
const char kTestRoot[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIBiDCCAS+gAwIBAgIUbaG4PLFlzKMn6j9otmP08wlJxBkwCgYIKoZIzj0EAwIw\n"
    "GTEXMBUGA1UEAwwOS2lubyBUZXN0IFJvb3QwIBcNMjYwOTI1MDUwNTU2WhgPMjEy\n"
    "NjA5MDEwNTA1NTZaMBkxFzAVBgNVBAMMDktpbm8gVGVzdCBSb290MFkwEwYHKoZI\n"
    "zj0CAQYIKoZIzj0DAQcDQgAEiC9PyEYGb3o4p4i3kDhxLAfHRcofw0W5OrtKtPnP\n"
    "R3DygQ9wIUbmEZU467I3a6vEH98obgpQN2PprkVSX7KMqKNTMFEwHQYDVR0OBBYE\n"
    "FIFV9ZKgSaOgD3fLNRVoVNVnvFlbMB8GA1UdIwQYMBaAFIFV9ZKgSaOgD3fLNRVo\n"
    "VNVnvFlbMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgQxs6nCjN\n"
    "CM8b9/bQraBuM6spnYH4zS4cxaD2YApB6pECICJGomZbiIJtqLxkvmnLO8Ei6zRh\n"
    "3ac7/N6uK+gPwsrB\n"
    "-----END CERTIFICATE-----\n";

} // namespace

class TlsRootsTest : public QObject {
    Q_OBJECT
private slots:
    void initTestCase() {
        QStandardPaths::setTestModeEnabled(true);
        QVERIFY(fixtures_.isValid());
        QFile root(fixtures_.filePath(QStringLiteral("root.pem")));
        QVERIFY(root.open(QIODevice::WriteOnly));
        root.write(kTestRoot);
        root.close();
        qputenv("KINO_TLS_EXTRA_ROOTS", root.fileName().toUtf8());
    }

    void exportsSystemRootsWithFixtureRoot() {
        const QString path = TlsRoots::bundlePath();
        QVERIFY(!path.isEmpty());
        const QList<QSslCertificate> bundle = QSslCertificate::fromPath(path, QSsl::Pem);
        // macOS ships well over a hundred trust anchors; a partial export
        // would leave ordinary HTTPS media unverifiable.
        QVERIFY2(bundle.size() > 100, qPrintable(QString::number(bundle.size())));
        bool letsEncrypt = false;
        bool fixture = false;
        for (const QSslCertificate &certificate : bundle) {
            const QString name = certificate.subjectInfo(QSslCertificate::CommonName).join(QString());
            letsEncrypt = letsEncrypt || name == QLatin1String("ISRG Root X1");
            fixture = fixture || name == QLatin1String("Kino Test Root");
        }
        QVERIFY(letsEncrypt);
        QVERIFY(fixture);
        // A bundle with a fixture authority never lands in the app's data.
        const QString appData = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
        QVERIFY(!path.startsWith(appData));
        QVERIFY(path.startsWith(QDir::tempPath()));
        QCOMPARE(TlsRoots::bundlePath(), path);
    }

    void cleanupTestCase() {
        QDir(QFileInfo(TlsRoots::bundlePath()).absolutePath()).removeRecursively();
    }

private:
    QTemporaryDir fixtures_;
};

QTEST_GUILESS_MAIN(TlsRootsTest)
#include "tlsroots_test.moc"
