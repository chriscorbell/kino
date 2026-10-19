export function inUpNextWindow(time: number, duration: number) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(time) &&
    time >= duration - Math.min(120_000, duration * 0.1)
  );
}
