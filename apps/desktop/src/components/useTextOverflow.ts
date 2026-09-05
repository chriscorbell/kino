import { useLayoutEffect, useState, type RefObject } from 'react';

export function useTextOverflow(
  ref: RefObject<HTMLElement | null>,
  text: string,
  expanded = false,
) {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    let active = true;
    const measure = () => {
      if (active) {
        setOverflowing(
          element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1,
        );
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [expanded, ref, text]);
  return overflowing;
}
