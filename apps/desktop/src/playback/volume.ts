// Volume has one owner, the `volume` Kino setting. The backend follows the
// setting, and the setting follows the backend only when the backend reports a
// volume Kino did not send: a media key, mpv itself, the browser's own control.
//
// Both players apply a volume asynchronously and report it back, so after 30,
// 42 and 47 are sent in quick succession, a late report of 30 can arrive after
// 47 was sent. Adopting it would undo the viewer's last step. Every value sent
// stays pending until it is reported; only a report matching nothing pending
// is a change made outside Kino.

export interface VolumeEchoes {
  /** Values sent to the backend that it has not reported yet, oldest first. */
  readonly pending: readonly number[];
  /** The backend's latest report, or null before its first. */
  readonly reported: number | null;
  /**
   * False until the backend is known to hold a value Kino sent. mpv observes
   * `volume` from start-up and can report its own default after Kino's
   * listener connects; adopting that would overwrite the saved volume.
   */
  readonly settled: boolean;
}

export const noVolumeEchoes: VolumeEchoes = { pending: [], reported: null, settled: false };

// `<video>` reports a 0..1 float, so 0.42 comes back as 42.00000000000001.
const matches = (a: number, b: number) => Math.abs(a - b) < 0.5;

export function sentVolume(echoes: VolumeEchoes, percent: number): VolumeEchoes {
  // Setting a volume a player already holds produces no report, so a send
  // matching what the player will hold once everything pending applies never
  // comes back.
  const held = echoes.pending.at(-1) ?? echoes.reported;
  if (held === null || !matches(held, percent)) {
    return { ...echoes, pending: [...echoes.pending, percent] };
  }
  return echoes.pending.length ? echoes : { ...echoes, settled: true };
}

/**
 * A report matching a pending value acknowledges it and every value sent
 * before it. Any other report, once settled, is a change made outside Kino,
 * returned as `adopt` in whole percent for the caller to save.
 */
export function observeVolume(
  echoes: VolumeEchoes,
  percent: number,
): { echoes: VolumeEchoes; adopt: number | null } {
  const index = echoes.pending.findIndex((sent) => matches(sent, percent));
  if (index >= 0) {
    return {
      echoes: { pending: echoes.pending.slice(index + 1), reported: percent, settled: true },
      adopt: null,
    };
  }
  return {
    echoes: { ...echoes, reported: percent },
    adopt: echoes.settled ? Math.round(percent) : null,
  };
}
