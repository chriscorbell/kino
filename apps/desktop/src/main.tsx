import '@fontsource-variable/geist';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CoreProvider } from './core/CoreProvider';
import { nativeShellPresent } from './native/player';
import './global.css';

if (nativeShellPresent()) document.documentElement.dataset.kinoNative = 'true';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Kino root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <CoreProvider>
        <App />
      </CoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
