#include "../src/platform.h"
#include "../src/shellcapabilities.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <cstdio>

// Prints what the bridge reports about this shell, for scripts/check-shell-capabilities.mjs.
int main() {
    const QJsonObject report{
        {QStringLiteral("platform"), Platform::name()},
        {QStringLiteral("capabilities"), QJsonArray::fromStringList(shellCapabilities())},
    };
    std::fputs(QJsonDocument(report).toJson(QJsonDocument::Compact).constData(), stdout);
    return 0;
}
