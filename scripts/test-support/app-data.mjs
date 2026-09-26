// Where Kino keeps its local data on each desktop platform, as Qt's AppLocalDataLocation places it.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function kinoLocalData() {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/Kino');
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Kino');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'Kino');
}
