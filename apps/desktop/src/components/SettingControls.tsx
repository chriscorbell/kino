import styles from '../App.module.css';

interface SettingSwitchProps {
  checked: boolean;
  disabled?: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

export function SettingSwitch({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: SettingSwitchProps) {
  return (
    <div className={styles.settingRow}>
      <div>
        <div className={styles.settingLabel}>{label}</div>
        <div className={styles.settingDescription}>{description}</div>
      </div>
      <button
        aria-checked={checked}
        disabled={disabled}
        aria-label={label}
        className={`${styles.switch} ${checked ? styles.switchChecked : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span />
      </button>
    </div>
  );
}

export function SettingSelect({
  disabled = false,
  description,
  id,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  description: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className={styles.settingRow} htmlFor={id}>
      <span>
        <span className={styles.settingLabel}>{label}</span>
        <span className={styles.settingDescription}>{description}</span>
      </span>
      <select
        className={styles.select}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
