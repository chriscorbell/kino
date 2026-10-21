// The Core gates load core/actions.ts, and this file through it, under Node's
// type stripping, so it keeps to `import type` and syntax Node can erase.
import type { CoreAction } from './types';

declare const durability: unique symbol;
declare const sessionOnly: unique symbol;

// Every action carries both brands, so one that reaches the Player model is no DurableAction or
// TransientAction, and widening it to one is a type error rather than a way past the session.
type Branded<Durability, Reach> = CoreAction & {
  readonly [durability]: Durability;
  readonly [sessionOnly]: Reach;
};

/** A change that must survive a closed window. */
export type DurableAction = Branded<'durable', 'not the Player model'>;

/** An action whose effect may be lost on close. */
export type TransientAction = Branded<'transient', 'not the Player model'>;

/** An action that reaches the Player model, so only the playback session sends it (ADR 0032). */
export type SessionOnly<Action extends DurableAction | TransientAction> = Branded<
  Action[typeof durability],
  'Player model'
>;

/** Unload sent with no model unloads every model, the Player model included. */
export type UnloadAction = Branded<'transient', 'Unload without a model'>;
