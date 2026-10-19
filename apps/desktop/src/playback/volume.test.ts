import { describe, expect, it } from 'vitest';

import { observeVolume, sentVolume, type InFlightVolumes } from './volume';

const send = (inFlight: InFlightVolumes, now: number, ...values: number[]) =>
  values.reduce((sent, percent) => sentVolume(sent, percent, now), inFlight);
const percents = (inFlight: InFlightVolumes) => inFlight.map(({ percent }) => percent);

describe('volume reports', () => {
  it('acknowledges a reported send and every send before it', () => {
    const { inFlight, adopt } = observeVolume(send([], 0, 42, 47, 52), 47, 10);

    expect(adopt).toBeNull();
    expect(percents(inFlight)).toEqual([52]);
  });

  it('ignores a late report of 30 after 42 and 47 were sent', () => {
    const { inFlight, adopt } = observeVolume(send([], 0, 30, 42, 47), 30, 10);

    expect(adopt).toBeNull();
    expect(percents(inFlight)).toEqual([42, 47]);
  });

  it('adopts a value reported with nothing in flight', () => {
    expect(observeVolume([], 65, 0).adopt).toBe(65);
  });

  it('ignores a report a send in flight will replace', () => {
    expect(observeVolume(send([], 0, 35), 20, 10).adopt).toBeNull();
    expect(observeVolume(send([], 0, 30), 100, 10).adopt).toBeNull();
  });

  it('expires a send the player never answers', () => {
    const unanswered = send([], 0, 100);

    expect(observeVolume(unanswered, 30, 999).adopt).toBeNull();
    expect(observeVolume(unanswered, 30, 1000)).toEqual({ inFlight: [], adopt: 30 });
  });

  it('adopts a stranded value once its send expires', () => {
    const merged = send([], 0, 47, 42);

    expect(observeVolume(merged, 47, 1000).adopt).toBe(47);
  });

  it('drops expired sends when it records a new one', () => {
    expect(percents(sentVolume(send([], 0, 47), 50, 1000))).toEqual([50]);
  });

  it("matches the browser's float reports within half a percent", () => {
    expect(observeVolume(send([], 0, 29), 0.29 * 100, 10)).toEqual({ inFlight: [], adopt: null });
    expect(observeVolume(send([], 0, 42), 42.4, 10).inFlight).toEqual([]);
    expect(observeVolume([], 65.4, 0).adopt).toBe(65);
  });
});
