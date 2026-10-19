import { describe, expect, it } from 'vitest';

import { noVolumeEchoes, observeVolume, sentVolume, type VolumeEchoes } from './volume';

const send = (echoes: VolumeEchoes, ...values: number[]) => values.reduce(sentVolume, echoes);
const settled = observeVolume(send(noVolumeEchoes, 30), 30).echoes;

describe('volume echoes', () => {
  it('acknowledges a reported value and every value sent before it', () => {
    const { echoes, adopt } = observeVolume(send(settled, 42, 47, 52), 47);

    expect(adopt).toBeNull();
    expect(echoes.pending).toEqual([52]);
  });

  it('ignores a late report of 30 after 42 and 47 were sent', () => {
    const { echoes, adopt } = observeVolume(send(noVolumeEchoes, 30, 42, 47), 30);

    expect(adopt).toBeNull();
    expect(echoes.pending).toEqual([42, 47]);
    expect(observeVolume(echoes, 47).adopt).toBeNull();
  });

  it('adopts a value Kino never sent', () => {
    expect(observeVolume(settled, 65).adopt).toBe(65);
    expect(observeVolume(send(settled, 42), 65).adopt).toBe(65);
  });

  it("ignores the player's start-up volume until a sent value is reported", () => {
    const startup = observeVolume(send(noVolumeEchoes, 30), 100);
    expect(startup.adopt).toBeNull();

    const acknowledged = observeVolume(startup.echoes, 30).echoes;
    expect(observeVolume(acknowledged, 100).adopt).toBe(100);
  });

  it('settles when the player already holds the value Kino sends', () => {
    const startup = observeVolume(noVolumeEchoes, 100);
    expect(startup.adopt).toBeNull();

    const echoes = sentVolume(startup.echoes, 100);
    expect(echoes.pending).toEqual([]);
    expect(observeVolume(echoes, 65).adopt).toBe(65);
  });

  it('leaves nothing pending when Kino resends the volume the player holds', () => {
    const resent = sentVolume(settled, 30);

    expect(resent.pending).toEqual([]);
    expect(observeVolume(send(resent, 42), 30).adopt).toBe(30);
  });

  it('expects one report for the same value sent twice in a row', () => {
    const { echoes } = observeVolume(send(settled, 95, 100, 100), 100);

    expect(echoes.pending).toEqual([]);
    const lowered = observeVolume(echoes, 70).echoes;
    expect(observeVolume(lowered, 100).adopt).toBe(100);
  });

  it("matches the browser's float reports within half a percent", () => {
    const pending = send(settled, 42);
    expect(observeVolume(pending, 0.42 * 100)).toMatchObject({
      adopt: null,
      echoes: { pending: [] },
    });
    expect(observeVolume(pending, 42.6).adopt).toBe(43);
    expect(observeVolume(settled, 65.4).adopt).toBe(65);
  });
});
