import { useId, useRef, useState, type CSSProperties } from 'react';

import styles from '../App.module.css';
import { t } from '../locales';
import { useTextOverflow } from './useTextOverflow';

export function ExpandableText({
  text,
  label,
  lines,
  className,
}: {
  text: string;
  label: string;
  lines: number;
  className: string | undefined;
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const overflowing = useTextOverflow(ref, text, expanded);
  return (
    <div className={className}>
      <p
        className={styles.expandableText}
        data-expanded={expanded}
        id={id}
        ref={ref}
        style={{ '--summary-lines': lines } as CSSProperties}
      >
        {text}
      </p>
      {overflowing || expanded ? (
        <button
          aria-controls={id}
          aria-expanded={expanded}
          aria-label={`${expanded ? t.actions.readLess : t.actions.readMore}: ${label}`}
          className={styles.summaryToggle}
          onClick={() => setExpanded((previous) => !previous)}
          type="button"
        >
          {expanded ? t.actions.readLess : t.actions.readMore}
        </button>
      ) : null}
    </div>
  );
}
