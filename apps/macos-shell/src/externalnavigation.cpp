#include "externalnavigation.h"

#include <QDesktopServices>
#include <QUrl>

bool ExternalNavigation::openUrl(const QString &value) {
    const QUrl url(value, QUrl::StrictMode);
    if (!url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() ||
        (url.scheme() != QStringLiteral("https") && url.scheme() != QStringLiteral("http"))) {
        return false;
    }
    return QDesktopServices::openUrl(url);
}
