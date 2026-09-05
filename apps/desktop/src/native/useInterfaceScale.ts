import { useEffect, useState } from 'react';

import type { InterfaceScale } from '../settings';
import { connectNativeInterface, nativeShellPresent } from './player';

export function useInterfaceScale(scale: InterfaceScale) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const available = nativeShellPresent();
  useEffect(() => {
    if (!available) return;
    let active = true;
    void connectNativeInterface()
      .then(async (native) => {
        if (!active) return;
        if (!native || !(await native.setScale(scale)))
          throw new Error('Interface scale was not applied.');
        if (active) setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, available, scale]);
  return { available, failed, retry: () => setAttempt((value) => value + 1) };
}

export type InterfaceScaleState = ReturnType<typeof useInterfaceScale>;
