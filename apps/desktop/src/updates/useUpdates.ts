import { useEffect, useState, useSyncExternalStore } from 'react';

import { connectNativePlayer, nativeShellPresent } from '../native/player';
import { UpdateCheck } from './UpdateCheck';

export function useUpdates() {
  const [client] = useState(
    () =>
      new UpdateCheck(
        {
          getItem: (key) => window.localStorage.getItem(key),
          setItem: (key, value) => window.localStorage.setItem(key, value),
        },
        (...args) => fetch(...args),
      ),
  );
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => {
    if (!nativeShellPresent()) return;
    let active = true;
    void connectNativePlayer()
      .then((player) => {
        if (!active || !player) return;
        client.initialize(player.shellVersion);
        void client.check();
      })
      .catch(() => {
        /* Settings reports update discovery as unavailable. */
      });
    const timer = window.setInterval(() => {
      void client.check();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client]);
  return { client, state };
}

export type Updates = ReturnType<typeof useUpdates>;
