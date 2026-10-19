import '@fontsource-variable/geist';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CoreProvider } from './core/CoreProvider';
import { migrateNativeAccountProfile } from './core/transport';
import { nativeShellPresent } from './native/player';
import { createKinoSettingsStore } from './settingsStore';
import { KinoSettingsProvider } from './useKinoSettings';
import './global.css';

if (nativeShellPresent()) document.documentElement.dataset.kinoNative = 'true';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Kino root element was not found.');
}
const rootElement = root;

async function start() {
  try {
    await migrateNativeAccountProfile();
  } catch (error) {
    console.error(
      '[kino:session] account migration failed',
      error instanceof Error ? error.message : 'UnknownError',
    );
  }

  const settingsStore = createKinoSettingsStore(window.localStorage);

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <KinoSettingsProvider value={settingsStore}>
          <CoreProvider>
            <App />
          </CoreProvider>
        </KinoSettingsProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void start();
