#include "addonnetwork.h"

#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPromise>
#include <QTimer>
#include <QUrl>

#include <memory>

namespace {
bool secureUrl(const QUrl &url) {
    return url.isValid() && url.scheme() == QStringLiteral("https")
        && !url.host().isEmpty() && url.userInfo().isEmpty();
}
}

QFuture<QVariantMap> AddonNetwork::get(const QString &value) {
    auto promise = std::make_shared<QPromise<QVariantMap>>();
    promise->start();
    auto future = promise->future();
    const QUrl url(value);
    if (!secureUrl(url)) {
        promise->addResult(QVariantMap{{"status", 403}, {"body", ""}});
        promise->finish();
        return future;
    }

    QNetworkRequest request(url);
    request.setRawHeader("Accept", "application/json");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::UserVerifiedRedirectPolicy);
    request.setMaximumRedirectsAllowed(10);
    auto *reply = manager_.get(request);
    auto body = std::make_shared<QByteArray>();
    auto blocked = std::make_shared<bool>(false);
    auto *deadline = new QTimer(reply);
    deadline->setSingleShot(true);
    connect(deadline, &QTimer::timeout, reply, &QNetworkReply::abort);
    deadline->start(10'000);
    connect(reply, &QNetworkReply::redirected, reply, [reply, blocked](const QUrl &target) {
        if (secureUrl(reply->url().resolved(target))) reply->redirectAllowed();
        else {
            *blocked = true;
            reply->abort();
        }
    });
    connect(reply, &QNetworkReply::readyRead, reply, [reply, body]() {
        body->append(reply->readAll());
        if (body->size() > 16 * 1024 * 1024) reply->abort();
    });
    connect(reply, &QNetworkReply::finished, reply, [reply, body, blocked, promise, deadline]() {
        deadline->stop();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool httpError = status >= 400 && status <= 599
            && reply->error() != QNetworkReply::OperationCanceledError;
        const bool completed = reply->error() == QNetworkReply::NoError || httpError;
        promise->addResult(QVariantMap{
            {"status", *blocked ? 403 : completed && status ? status : 502},
            {"body", completed && !*blocked ? QString::fromUtf8(*body) : QString()},
        });
        promise->finish();
        reply->deleteLater();
    });
    return future;
}
