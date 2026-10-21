import { it } from 'vitest';

import {
  finalPauseAction,
  loadBoardAction,
  logoutAction,
  playerAction,
  unloadAction,
} from './actions';
import type { CoreTransport, FeatureTransport } from './transport';
import type { DurableAction, TransientAction } from './writes';

const transport: Pick<CoreTransport, 'commit' | 'dispatch'> = {
  commit: async () => {},
  dispatch: async () => {},
};
const feature: Pick<FeatureTransport, 'commit' | 'dispatch' | 'getState'> = {
  ...transport,
  getState: async () => ({}) as never,
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

it('compiles Unload only with a model, since a model-less Unload reaches the Player model', async () => {
  await transport.dispatch(unloadAction, 'board');
  // @ts-expect-error Unload without a model
  await transport.dispatch(unloadAction);
});

it('compiles nothing that reaches the Player model on the transport features hold', async () => {
  await feature.dispatch(loadBoardAction, 'board');
  await feature.commit(logoutAction);
  await feature.dispatch(unloadAction, 'board');
  // @ts-expect-error Unload without a model
  await feature.dispatch(unloadAction);
  // @ts-expect-error a Player report
  await feature.dispatch(playerAction('Ended'));
  // @ts-expect-error the final save
  await feature.commit(finalPauseAction);
  // @ts-expect-error the Player model
  await feature.dispatch(loadBoardAction, 'player');
  // @ts-expect-error the Player model's state
  await feature.getState('player');
});

it('compiles no widening that would hide an action reaching the Player model', () => {
  // @ts-expect-error a widened Unload
  const unload: TransientAction = unloadAction;
  // @ts-expect-error a widened final save
  const save: DurableAction = finalPauseAction;
  return [unload, save];
});
