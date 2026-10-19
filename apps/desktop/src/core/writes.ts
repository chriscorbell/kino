// The Core gates load core/actions.ts, and this file through it, under Node's
// type stripping, so it keeps to `import type` and syntax Node can erase.
import type { CoreAction } from './types';

declare const durability: unique symbol;

/** A change that must survive a closed window. */
export type DurableAction = CoreAction & { readonly [durability]: 'durable' };

/** An action whose effect may be lost on close. */
export type TransientAction = CoreAction & { readonly [durability]: 'transient' };

/** For action builders only, so every action that reaches Core had its durability decided. */
export function durable(action: CoreAction): DurableAction {
  return action as DurableAction;
}

export function transient(action: CoreAction): TransientAction {
  return action as TransientAction;
}
