import { useRef, useState } from 'react';

interface Messages {
  pending: string;
  success: string;
  failed: string;
}

interface Operation {
  scope: unknown;
  run: () => Promise<void>;
  messages: Messages;
}

interface Result {
  operation: Operation;
  status: 'pending' | 'success' | 'failed';
}

// Scope binds an action to its profile or item. A late result cannot replace
// feedback for a new profile, and retries never cross that boundary.
export function useActionFeedback(scope: unknown = null) {
  const active = useRef<Operation | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.operation.scope === scope ? result : null;
  const run = (operation: () => Promise<void>, messages: Messages) => {
    if (active.current?.scope === scope) return;
    const task = { scope, run: operation, messages };
    active.current = task;
    setResult({ operation: task, status: 'pending' });
    const finish = (status: 'success' | 'failed') => {
      if (active.current === task) active.current = null;
      setResult((previous) =>
        previous?.operation === task ? { operation: task, status } : previous,
      );
    };
    void (async () => {
      try {
        await operation();
        finish('success');
      } catch {
        finish('failed');
      }
    })();
  };
  return {
    pending: current?.status === 'pending',
    failed: current?.status === 'failed',
    message: current ? current.operation.messages[current.status] : null,
    run,
    retry: () => {
      if (current?.status === 'failed') run(current.operation.run, current.operation.messages);
    },
  };
}

export type ActionFeedbackState = ReturnType<typeof useActionFeedback>;
