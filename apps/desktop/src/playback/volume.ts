// Volume has one owner, the `volume` Kino setting. The backend follows the
// setting, and the setting follows the backend only when the backend reports a
// volume Kino did not send, such as one set through mpv itself or the
// browser's own control.
//
// Both players apply a volume asynchronously and report it only when it
// changes, so a send can be answered late or never: neither reports a value it
// already holds, and mpv merges quick changes into one report of where it
// ended. A send therefore stays in flight until a report matches it or
// `inFlightMs` passes. While anything is in flight, a report that matches
// nothing describes a state a send will replace, such as mpv's start-up
// default or a volume from before the viewer's last step, so it is ignored.

export type InFlightVolumes = readonly { readonly percent: number; readonly sentAt: number }[];

const inFlightMs = 1000;

// `<video>` reports a 0..1 float, so 0.29 comes back as 28.999999999999996.
const matches = (a: number, b: number) => Math.abs(a - b) < 0.5;

const live = (inFlight: InFlightVolumes, now: number) =>
  inFlight.filter(({ sentAt }) => now - sentAt < inFlightMs);

export function sentVolume(
  inFlight: InFlightVolumes,
  percent: number,
  now: number,
): InFlightVolumes {
  return [...live(inFlight, now), { percent, sentAt: now }];
}

/**
 * A report matching a send in flight acknowledges it and every send before
 * it. A report with nothing in flight is a change made outside Kino, returned
 * as `adopt` in whole percent for the caller to save.
 */
export function observeVolume(
  inFlight: InFlightVolumes,
  percent: number,
  now: number,
): { inFlight: InFlightVolumes; adopt: number | null } {
  const pending = live(inFlight, now);
  const index = pending.findIndex((sent) => matches(sent.percent, percent));
  if (index >= 0) return { inFlight: pending.slice(index + 1), adopt: null };
  return { inFlight: pending, adopt: pending.length ? null : Math.round(percent) };
}
