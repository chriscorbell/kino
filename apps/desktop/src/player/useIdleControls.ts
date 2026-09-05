import { useEffect, useState, type RefObject } from 'react';

const idleDelay = 3_000;
const activityEvents = [
  'pointermove',
  'pointerdown',
  'pointerleave',
  'keydown',
  'focusin',
  'focusout',
  'focus',
  'blur',
] as const;

export function useIdleControls(
  topbar: RefObject<HTMLElement | null>,
  controls: RefObject<HTMLElement | null>,
  pinned: boolean,
) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (pinned) return;
      timer = window.setTimeout(() => {
        const interacting = [topbar.current, controls.current].some(
          (bar) =>
            bar &&
            (bar.matches(':hover') || (document.hasFocus() && bar.querySelector(':focus-visible'))),
        );
        if (!interacting) setVisible(false);
      }, idleDelay);
    };
    const show = () => {
      setVisible(true);
      schedule();
    };
    show();
    for (const event of activityEvents) window.addEventListener(event, show, true);
    return () => {
      window.clearTimeout(timer);
      for (const event of activityEvents) window.removeEventListener(event, show, true);
    };
  }, [controls, pinned, topbar]);

  return pinned || visible;
}
