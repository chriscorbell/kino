import { useEffect, useState } from 'react';

import { connectShellReport, knownShellReport } from './player';

/** The shell's report of its platform and capabilities, or null until it answers. */
export function useShellReport() {
  const [report, setReport] = useState(knownShellReport);
  useEffect(() => {
    if (report) return;
    let active = true;
    void connectShellReport().then(
      (answer) => {
        if (active) setReport(answer);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [report]);
  return report;
}
