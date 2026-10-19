#pragma once

#include <QStringList>

// What this shell can apply of the Kino settings that need one, named as
// packages/settings/src/schema.ts names them. The bridge reports the list to the
// client, and Settings shows such a setting only where the list has its
// capability. The shell_capabilities CTest holds the list to the schema.
QStringList shellCapabilities();
