// The Core gates load core/actions.ts, and this file through it, under Node's
// type stripping, so it keeps to `import type` and syntax Node can erase.
import type { CoreAction } from './types';

declare const durability: unique symbol;

/**
 * A change that must survive a closed window: library and watched state,
 * profile settings, add-ons, sign-out, and the player's final save. Only
 * `transport.commit` accepts it.
 */
export type DurableAction = CoreAction & { readonly [durability]: 'durable' };

/**
 * An action whose effect may be lost on close: loads, paging, ranges, and the
 * progress reports the final save supersedes. Only `transport.dispatch`
 * accepts it.
 */
export type TransientAction = CoreAction & { readonly [durability]: 'transient' };

/**
 * For the builders in core/actions.ts. An object literal carries neither
 * brand, so it reaches no transport method without a builder that decided.
 */
export function durable(action: CoreAction): DurableAction {
  return action as DurableAction;
}

export function transient(action: CoreAction): TransientAction {
  return action as TransientAction;
}
