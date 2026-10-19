import { it } from 'vitest';

import { loadBoardAction, logoutAction } from './actions';
import type { CoreTransport } from './transport';

// `pnpm typecheck` compiles this file, and each directive fails it if the call
// below the directive compiles.
it('accepts a durable action only on commit and a transient one only on dispatch', async () => {
  const transport: Pick<CoreTransport, 'commit' | 'dispatch'> = {
    commit: async () => {},
    dispatch: async () => {},
  };
  await transport.commit(logoutAction);
  await transport.dispatch(loadBoardAction);
  // @ts-expect-error A durable action has to wait for storage, so dispatch refuses it.
  await transport.dispatch(logoutAction);
  // @ts-expect-error commit refuses an action that may be lost on close.
  await transport.commit(loadBoardAction);
  // @ts-expect-error An object literal has no brand, so it needs a builder to reach Core.
  await transport.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
  // @ts-expect-error An object literal has no brand, so it needs a builder to reach Core.
  await transport.commit({ action: 'Ctx', args: { action: 'Logout' } });
});
