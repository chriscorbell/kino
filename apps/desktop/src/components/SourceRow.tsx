import { Play } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';

import styles from '../App.module.css';
import { hasStructure, sizeLabel, type SourceFields } from '../core/sourceFields';
import { t as enUS } from '../locales';

/**
 * One source as a structured row. The row button is the only thing that
 * plays. Details beside it opens the complete add-on text and the fields too
 * rare for a row, in place, and never starts playback; focus stays on the
 * toggle, so closing puts the reader back where they were.
 */
export function SourceRow({
  addonName,
  disabled,
  external,
  failed,
  fields,
  onSelect,
  playable,
  selectable,
  unavailable,
}: {
  addonName: string;
  disabled: boolean;
  external: URL | null;
  failed: boolean;
  fields: SourceFields;
  onSelect: () => void;
  playable: boolean;
  selectable: boolean;
  unavailable: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `${id}-details`;
  const structured = hasStructure(fields);
  const lead = structured ? [fields.resolution, fields.releaseType].filter(Boolean).join(' ') : '';
  const traits = structured
    ? [
        fields.videoRange,
        fields.videoCodec,
        fields.audio,
        ...fields.languages,
        fields.releaseGroup,
      ].filter((value): value is string => Boolean(value))
    : [];
  const size = sizeLabel(fields.size);

  return (
    <div className={styles.sourceRow}>
      <div className={styles.sourceLine}>
        <button
          className={styles.sourceButton}
          disabled={disabled}
          id={id}
          onClick={onSelect}
          type="button"
        >
          <span className={styles.sourceLead}>{lead || fields.fallbackTitle}</span>
          <span className={styles.sourceTraits}>
            {traits.map((trait, index) => (
              <span key={`${trait}-${index}`}>{trait}</span>
            ))}
          </span>
          <span className={styles.sourceFigures}>
            <span>{size}</span>
            <span>{fields.bitrate}</span>
          </span>
          <span className={styles.sourceAddon}>{addonName}</span>
          <span className={styles.sourceAction}>
            {playable ? (
              <span className={styles.sourcePlay}>
                <Play aria-hidden size={14} weight="fill" />
                {enUS.details.playSource}
              </span>
            ) : null}
            {external ? (
              <span className={styles.sourceExplanation}>
                {enUS.details.openExternal} · {external.host}
              </span>
            ) : null}
            {!selectable ? (
              <>
                <em>{enUS.details.unavailable}</em>
                <span className={styles.sourceExplanation}>{unavailable}</span>
              </>
            ) : null}
            {playable && failed ? <em>{enUS.details.failed}</em> : null}
          </span>
        </button>
        <button
          aria-controls={panelId}
          aria-describedby={id}
          aria-expanded={open}
          className={styles.sourceDetailsToggle}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {enUS.details.inspectSource}
        </button>
      </div>
      {open ? (
        <dl className={styles.sourceDescription} id={panelId}>
          {fields.original.filename ? (
            <Field label={enUS.details.filename}>{fields.original.filename}</Field>
          ) : null}
          {fields.original.description ? (
            <Field label={enUS.details.sourceAddonText}>{fields.original.description}</Field>
          ) : null}
          <Field label={enUS.details.sourceAddon}>{addonName}</Field>
          {fields.releaseGroup ? (
            <Field label={enUS.details.sourceReleaseGroup}>{fields.releaseGroup}</Field>
          ) : null}
          {fields.languages.length > 0 ? (
            <Field label={enUS.details.sourceLanguages}>{fields.languages.join(', ')}</Field>
          ) : null}
          {size ? <Field label={enUS.details.sourceSize}>{size}</Field> : null}
          {fields.bitrate ? (
            <Field label={enUS.details.sourceBitrate}>
              {fields.bitrate}
              {fields.bitrate.startsWith('~') ? (
                <small> {enUS.details.sourceBitrateEstimated}</small>
              ) : null}
            </Field>
          ) : null}
          {fields.peers !== null ? (
            <Field label={enUS.details.sourcePeers}>{fields.peers}</Field>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
