import { useEffect, useState } from 'react';

import { t } from '../locales';
import { connectShellReport, knownShellReport, type ShellReport } from './player';

/**
 * The shell's report of its platform and capabilities, null until it answers, or the error that
 * kept it from answering, which a screen shows rather than guessing a platform.
 */
export function useShellReport() {
  const [report, setReport] = useState<ShellReport | Error | null>(knownShellReport);
  useEffect(() => {
    if (report) return;
    let active = true;
    void connectShellReport().then(
      (answer) => {
        if (active) setReport(answer);
      },
      (error: unknown) => {
        if (active)
          setReport(error instanceof Error ? error : new Error(t.core.nativeServicesUnavailable));
      },
    );
    return () => {
      active = false;
    };
  }, [report]);
  return report;
}
