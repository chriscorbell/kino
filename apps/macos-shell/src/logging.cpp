#include "logging.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMutex>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QThread>

#include <cstdio>
#include <memory>

namespace {

constexpr qint64 MaxLogSize = 10 * 1024 * 1024;
constexpr int ArchivedLogCount = 4;
constexpr qsizetype MaxRecordSize = 64 * 1024;

QByteArray boundedRecord(QByteArray record) {
    if (record.size() > MaxRecordSize) {
        const QByteArray suffix(" [truncated]\n");
        qsizetype end = MaxRecordSize - suffix.size();
        // Move a cut inside a multibyte character back to its first byte.
        while (end > 0 && (static_cast<unsigned char>(record.at(end)) & 0xc0) == 0x80) {
            --end;
        }
        record.truncate(end);
        record.append(suffix);
    }
    return record;
}

QString sanitize(QString message) {
    static const QRegularExpression urlPattern(
        R"((?:https?|magnet):[^\s\"'<>]+)",
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression credentialPattern(
        R"((authorization|password|token|secret|api[_-]?key)(\s*[=:]\s*|\s+)[^\s,;}]+)",
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression emailPattern(
        R"([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})",
        QRegularExpression::CaseInsensitiveOption);

    message.replace(urlPattern, QStringLiteral("<redacted-url>"));
    message.replace(credentialPattern, QStringLiteral("\\1\\2<redacted>"));
    message.replace(emailPattern, QStringLiteral("<redacted-email>"));
    return message;
}

QString levelName(QtMsgType type) {
    switch (type) {
    case QtDebugMsg:
        return QStringLiteral("DEBUG");
    case QtInfoMsg:
        return QStringLiteral("INFO");
    case QtWarningMsg:
        return QStringLiteral("WARN");
    case QtCriticalMsg:
        return QStringLiteral("ERROR");
    case QtFatalMsg:
        return QStringLiteral("FATAL");
    }
    return QStringLiteral("UNKNOWN");
}

class RotatingLogger {
public:
    explicit RotatingLogger(QString directory)
        : directory_(std::move(directory)), path_(directory_ + QStringLiteral("/kino.log")) {
        QDir().mkpath(directory_);
        open();
    }

    void write(QtMsgType type, const QMessageLogContext &context, const QString &message) {
        QMutexLocker locker(&mutex_);
        if (!file_.isOpen()) {
            const QByteArray sanitized = boundedRecord(sanitize(message).toUtf8());
            std::fprintf(stderr, "%s\n", sanitized.constData());
            return;
        }

        const QString category = context.category ? QString::fromUtf8(context.category)
                                                   : QStringLiteral("default");
        const QString source = context.file ? QFileInfo(QString::fromUtf8(context.file)).fileName()
                                            : QStringLiteral("unknown");
        const QString line = QStringLiteral("%1 [%2] [%3] [thread:%4] %5:%6 %7\n")
                                 .arg(QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs),
                                      levelName(type), category,
                                      QString::number(reinterpret_cast<quintptr>(
                                          QThread::currentThreadId()),
                                                      16),
                                      source, QString::number(context.line), sanitize(message));
        const QByteArray encoded = boundedRecord(line.toUtf8());
        if (file_.size() + encoded.size() > MaxLogSize) {
            rotate();
        }
        file_.write(encoded);
        file_.flush();
        std::fwrite(encoded.constData(), 1, static_cast<size_t>(encoded.size()), stderr);
    }

private:
    void open() {
        file_.setFileName(path_);
        if (!file_.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
            std::fprintf(stderr, "Kino could not open its local log.\n");
        }
    }

    void rotate() {
        file_.close();
        QFile::remove(path_ + QStringLiteral(".%1").arg(ArchivedLogCount));
        for (int index = ArchivedLogCount - 1; index >= 1; --index) {
            QFile::rename(path_ + QStringLiteral(".%1").arg(index),
                          path_ + QStringLiteral(".%1").arg(index + 1));
        }
        QFile::rename(path_, path_ + QStringLiteral(".1"));
        open();
    }

    QString directory_;
    QFile file_;
    QMutex mutex_;
    QString path_;
};

std::unique_ptr<RotatingLogger> logger;

void messageHandler(QtMsgType type, const QMessageLogContext &context, const QString &message) {
    if (logger) {
        logger->write(type, context, message);
    }
    if (type == QtFatalMsg) {
        std::abort();
    }
}

} // namespace

void installLocalLogger() {
    const QString dataDirectory = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    installLocalLogger(dataDirectory + QStringLiteral("/logs"));
}

void installLocalLogger(const QString &directory) {
    logger = std::make_unique<RotatingLogger>(directory);
    qInstallMessageHandler(messageHandler);
}

void logWebConsoleMessage(QtMsgType type, const QString &message) {
    // Web messages may contain provider URLs or account data. Omit the entire
    // message if sanitization changes it, and never attach the script URL.
    if (sanitize(message) != message) return;
    QString record = message;
    record.replace(QLatin1Char('\r'), QStringLiteral("\\r"));
    record.replace(QLatin1Char('\n'), QStringLiteral("\\n"));
    const QByteArray encoded = record.toUtf8();
    const QMessageLogger web(nullptr, 0, nullptr, "kino.web");
    switch (type) {
    case QtInfoMsg:
        web.info("%s", encoded.constData());
        break;
    case QtWarningMsg:
        web.warning("%s", encoded.constData());
        break;
    case QtCriticalMsg:
        web.critical("%s", encoded.constData());
        break;
    default:
        break;
    }
}
