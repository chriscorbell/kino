#include "shellcapabilities.h"

#include "displaymode.h"

QStringList shellCapabilities() {
    QStringList capabilities{QStringLiteral("interfaceScale")};
    if (DisplayModeMatcher::switchesModes()) capabilities << QStringLiteral("refreshRateMatching");
    return capabilities;
}
