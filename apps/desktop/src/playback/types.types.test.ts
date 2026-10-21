import { it } from 'vitest';

import { playerAction, unloadAction, unloadPlayerAction } from '../core/actions';
import type { CoreTransport } from '../core/transport';
import type { PlayerCorePort } from './types';

const reporterPort: Pick<PlayerCorePort, 'dispatch'> = { dispatch: async () => {} };

it('compiles no Unload on the port the progress reporter holds', async () => {
  await reporterPort.dispatch(playerAction('Seek', { time: 0, duration: 1 }), 'player');
  // @ts-expect-error transient Unload on the Player port
  await reporterPort.dispatch(unloadAction, 'player');
  // @ts-expect-error durable Unload on the Player port
  await reporterPort.dispatch(unloadPlayerAction, 'player');
});

it('compiles playerAction on the transport only for the progress reports the final save supersedes', async () => {
  const transport: Pick<CoreTransport, 'dispatch'> = { dispatch: async () => {} };
  await transport.dispatch(playerAction('PausedChanged', { paused: false }));
  // @ts-expect-error a Player write
  await transport.dispatch(playerAction('NextVideo'));
});
