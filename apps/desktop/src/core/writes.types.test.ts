import { it } from 'vitest';

import { loadBoardAction, logoutAction, playerAction } from './actions';
import type { CoreTransport } from './transport';

const transport: Pick<CoreTransport, 'commit' | 'dispatch'> = {
  commit: async () => {},
  dispatch: async () => {},
};

it('compiles a durable action only on commit and a transient one only on dispatch', async () => {
  await transport.commit(logoutAction);
  await transport.dispatch(loadBoardAction);
  // @ts-expect-error durable on dispatch
  await transport.dispatch(logoutAction);
  // @ts-expect-error transient on commit
  await transport.commit(loadBoardAction);
});

it('compiles no object literal on either method, so every action comes from a builder', async () => {
  // @ts-expect-error literal on dispatch
  await transport.dispatch({ action: 'Ctx', args: { action: 'Logout' } });
  // @ts-expect-error literal on commit
  await transport.commit({ action: 'Ctx', args: { action: 'Logout' } });
});

it('compiles playerAction only for the progress reports the final save supersedes', async () => {
  await transport.dispatch(playerAction('PausedChanged', { paused: false }));
  // @ts-expect-error a Player write
  await transport.dispatch(playerAction('NextVideo'));
});
