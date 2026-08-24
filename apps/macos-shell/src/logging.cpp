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
            const QByteArray sanitized = sanitize(message).toUtf8();
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
        const QByteArray encoded = line.toUtf8();
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
    logger = std::make_unique<RotatingLogger>(dataDirectory + QStringLiteral("/logs"));
    qInstallMessageHandler(messageHandler);
}
