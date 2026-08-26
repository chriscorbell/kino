import { Trash } from '@phosphor-icons/react';
import { useState } from 'react';

import styles from '../App.module.css';
import { installAddonAction, uninstallAddonAction } from '../core/actions';
import { useCore } from '../core/context';
import type { CoreAddon, ProfileState } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { enUS } from '../locales/en-US';

function isManifest(value: unknown): value is CoreAddon['manifest'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

export function AddonsScreen() {
  const { transport } = useCore();
  const profile = useCoreModel<ProfileState>('ctx', null, 'addons-profile');
  const [manifestUrl, setManifestUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addons = profile.state?.profile.addons ?? [];

  const install = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = manifestUrl.trim();
    if (!transport || !url || busy) return;
    // ADR 0012 keeps remote add-on transports on HTTPS.
    if (!url.startsWith('https://')) {
      setError(enUS.addons.insecure);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Manifest returned ${response.status}.`);
      const manifest: unknown = await response.json();
      if (!isManifest(manifest)) throw new Error('That URL did not return an add-on manifest.');
      await transport.dispatch(installAddonAction({ flags: {}, manifest, transportUrl: url }));
      setManifestUrl('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : enUS.addons.installFailed);
      console.error('[kino:addons] install failed', cause);
    } finally {
      setBusy(false);
    }
  };

  const uninstall = (addon: CoreAddon) => {
    if (!transport) return;
    void transport.dispatch(uninstallAddonAction(addon)).catch((cause: unknown) => {
      setError(enUS.addons.removeFailed);
      console.error('[kino:addons] remove failed', cause);
    });
  };

  return (
    <div className={`${styles.page} ${styles.narrowPage}`}>
      <h1>{enUS.addons.title}</h1>
      <p className={styles.lede}>{enUS.addons.description}</p>

      <form className={styles.addonForm} onSubmit={install}>
        <label className={styles.visuallyHidden} htmlFor="addon-url">
          {enUS.addons.manifestLabel}
        </label>
        <input
          className={styles.textField}
          id="addon-url"
          onChange={(event) => setManifestUrl(event.target.value)}
          placeholder={enUS.addons.manifestPlaceholder}
          type="url"
          value={manifestUrl}
        />
        <button disabled={busy || !manifestUrl.trim()} type="submit">
          {busy ? enUS.addons.installing : enUS.addons.install}
        </button>
      </form>
      {error ? <p className={styles.loadError}>{error}</p> : null}

      {profile.loading ? <p className={styles.inlineEmpty}>{enUS.addons.loading}</p> : null}
      {!profile.loading && addons.length === 0 ? (
        <p className={styles.inlineEmpty}>{enUS.addons.empty}</p>
      ) : null}

      <div className={styles.addonList}>
        {addons.map((addon) => (
          <div className={styles.addonRow} key={addon.transportUrl}>
            {addon.manifest.logo ? (
              <img alt="" className={styles.addonLogo} src={addon.manifest.logo} />
            ) : (
              <span className={styles.addonLogo} />
            )}
            <div className={styles.addonCopy}>
              <strong>
                {addon.manifest.name}
                {addon.manifest.version ? <small> {addon.manifest.version}</small> : null}
              </strong>
              {addon.manifest.description ? <p>{addon.manifest.description}</p> : null}
              <span className={styles.addonTypes}>
                {(addon.manifest.types ?? []).join(' · ') || addon.manifest.id}
              </span>
            </div>
            {addon.flags?.protected ? (
              <span className={styles.addonBadge}>{enUS.addons.protectedAddon}</span>
            ) : (
              <button
                aria-label={`${enUS.addons.remove} ${addon.manifest.name}`}
                className={styles.addonRemove}
                onClick={() => uninstall(addon)}
                type="button"
              >
                <Trash aria-hidden size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
