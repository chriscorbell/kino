import { createContext, useContext } from 'react';

import type { CoreSession } from './storage';
import type { CoreTransport } from './transport';

export type CoreStatus = 'error' | 'loading' | 'ready' | 'unavailable';

export interface CoreContextValue {
  error: string | null;
  selectSession(session: CoreSession): void;
  session: CoreSession;
  status: CoreStatus;
  transport: CoreTransport | null;
}

export const CoreContext = createContext<CoreContextValue>({
  error: null,
  selectSession: () => undefined,
  session: 'guest',
  status: 'loading',
  transport: null,
});

export function useCore() {
  return useContext(CoreContext);
}

// Startup recovery is separate from the model transport so optional catalog
// retries do not invalidate every mounted model subscription.
export const CoreRecoveryContext = createContext({
  retry: () => {},
  retryCatalog: () => {},
  catalogLoading: false,
  catalogError: null as string | null,
});

export function useCoreRecovery() {
  return useContext(CoreRecoveryContext);
}
