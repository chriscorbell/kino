#pragma once

#include <QString>

void installLocalLogger();
void installLocalLogger(const QString &directory);

void logWebConsoleMessage(QtMsgType type, const QString &message);
