import { settingShown } from '@kino/settings';
import { useEffect, useState } from 'react';

import type { InterfaceScale } from '../settings';
import { connectNativeInterface, connectShellReport } from './player';

export function useInterfaceScale(scale: InterfaceScale) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    // Each attempt asks the shell again, so a failed first handshake still offers Retry.
    void connectShellReport()
      .then(async ({ platform, capabilities }) => {
        if (!settingShown('interfaceScale', platform, capabilities)) return;
        const native = await connectNativeInterface();
        if (!active) return;
        if (!native || !(await native.setScale(scale)))
          throw new Error('Interface scale was not applied.');
      })
      .then(
        () => {
          if (active) setFailed(false);
        },
        () => {
          if (active) setFailed(true);
        },
      );
    return () => {
      active = false;
    };
  }, [attempt, scale]);
  return { failed, retry: () => setAttempt((value) => value + 1) };
}

export type InterfaceScaleState = ReturnType<typeof useInterfaceScale>;
