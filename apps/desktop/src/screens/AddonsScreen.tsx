import { Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import styles from '../App.module.css';
import { uninstallAddonAction } from '../core/actions';
import { addonFromManifest, CoreContractError } from '../core/adapters';
import {
  addonConfigurationUrl,
  addonManifestUrl,
  AddonReplacementError,
  installAddonConfiguration,
} from '../core/addonConfiguration';
import { openExternalUrl } from '../native/externalNavigation';
import { nativeShellPresent } from '../native/player';
import { AddonTransportError, addonTransportIssue, createAddonNetwork } from '../core/addonNetwork';
import { useCore } from '../core/context';
import type { CoreAddon } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';

export function AddonsScreen() {
  const { transport } = useCore();
  const profile = useCoreModel('ctx', null, 'addons-profile');
  const [manifestUrl, setManifestUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requiredConfiguration, setRequiredConfiguration] = useState<CoreAddon | null>(null);
  const [pendingInstall, setPendingInstall] = useState<{
    addon: CoreAddon;
    previous: CoreAddon[];
  } | null>(null);
  const [profileTransport, setProfileTransport] = useState(transport);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [transport],
  );
  if (profileTransport !== transport) {
    setProfileTransport(transport);
    setManifestUrl('');
    setBusy(false);
    setError(null);
    setMessage(null);
    setRequiredConfiguration(null);
    setPendingInstall(null);
  }
  const addons = profile.state?.profile.addons ?? [];

  const completeInstall = async (addon: CoreAddon, previous: CoreAddon[] = []) => {
    if (!transport || busy) return;
    const current = epoch.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await installAddonConfiguration(transport, addon, previous);
      if (current !== epoch.current) return;
      setManifestUrl('');
      setPendingInstall(null);
      setRequiredConfiguration(null);
      setMessage(previous.length > 0 ? enUS.addons.configurationReplaced : enUS.addons.installed);
    } catch (cause) {
      if (current !== epoch.current) return;
      setError(
        cause instanceof AddonReplacementError
          ? enUS.addons.replaceFailed
          : enUS.addons.installFailed,
      );
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };

  const install = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = addonManifestUrl(manifestUrl);
    if (!transport || !url || busy) return;
    const issue = addonTransportIssue(url, import.meta.env.DEV);
    if (issue) {
      setError(enUS.addons.transportIssues[issue]);
      return;
    }
    const current = epoch.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    setRequiredConfiguration(null);
    setPendingInstall(null);
    try {
      const response = await createAddonNetwork(fetch, import.meta.env.DEV).fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Manifest request failed.');
      // The same checks a stored descriptor gets, so an install sends Core a
      // manifest it accepts and keeps every field Kino does not display.
      const addon = addonFromManifest(url, await response.json());
      if (current !== epoch.current) return;
      if (addon.manifest.behaviorHints.configurationRequired) {
        setRequiredConfiguration(addon);
        setMessage(enUS.addons.configurationInstructions);
        return;
      }
      const context = await transport.getState('ctx');
      if (current !== epoch.current) return;
      const previous = context.profile.addons.filter(
        (installed) =>
          installed.manifest.id === addon.manifest.id && installed.transportUrl !== url,
      );
      if (previous.length > 0) {
        setPendingInstall({ addon, previous });
        return;
      }
      await installAddonConfiguration(transport, addon);
      if (current !== epoch.current) return;
      setManifestUrl('');
      setMessage(enUS.addons.installed);
    } catch (cause: unknown) {
      if (current !== epoch.current) return;
      setError(
        cause instanceof AddonTransportError
          ? enUS.addons.transportIssues[cause.issue]
          : enUS.addons.installFailed,
      );
      console.error(
        '[kino:addons] install failed',
        cause instanceof CoreContractError ? cause.message : '',
      );
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };

  const configure = async (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    const current = epoch.current;
    setMessage(enUS.addons.configurationInstructions);
    setError(null);
    if (!nativeShellPresent()) return;
    event.preventDefault();
    try {
      await openExternalUrl(url);
    } catch {
      if (current === epoch.current) setError(enUS.addons.configurationOpenFailed);
    }
  };

  const configurationLink = (addon: CoreAddon) => {
    const url = addonConfigurationUrl(addon, import.meta.env.DEV);
    return url ? (
      <a
        aria-label={enUS.addons.configureTitle(addon.manifest.name)}
        className={styles.secondaryButton}
        href={url}
        onClick={(event) => {
          void configure(event, url);
        }}
        rel="noopener noreferrer"
        target="_blank"
      >
        {enUS.addons.configure}
      </a>
    ) : null;
  };

  const uninstall = (addon: CoreAddon) => {
    if (!transport || busy) return;
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
          disabled={busy}
          onChange={(event) => {
            setManifestUrl(event.target.value);
            setRequiredConfiguration(null);
            setPendingInstall(null);
            setError(null);
          }}
          placeholder={enUS.addons.manifestPlaceholder}
          type="url"
          value={manifestUrl}
        />
        <button disabled={busy || !manifestUrl.trim()} type="submit">
          {busy ? enUS.addons.installing : enUS.addons.install}
        </button>
      </form>
      {pendingInstall ? (
        <div className={styles.addonConfiguration}>
          <p>{enUS.addons.configurationExists(pendingInstall.addon.manifest.name)}</p>
          {pendingInstall.previous.some((addon) => addon.flags.protected) ? (
            <p>{enUS.addons.requiredConfigurationProtected}</p>
          ) : null}
          <div className={styles.addonActions}>
            <button
              className={styles.secondaryButton}
              disabled={busy || pendingInstall.previous.some((addon) => addon.flags.protected)}
              onClick={() => {
                void completeInstall(pendingInstall.addon, pendingInstall.previous);
              }}
              type="button"
            >
              {enUS.addons.replaceExisting}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => {
                void completeInstall(pendingInstall.addon);
              }}
              type="button"
            >
              {enUS.addons.keepBoth}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => setPendingInstall(null)}
              type="button"
            >
              {enUS.actions.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {requiredConfiguration ? (
        <div className={styles.addonConfiguration}>{configurationLink(requiredConfiguration)}</div>
      ) : null}
      <div aria-live="polite">
        {message ? (
          <p className={styles.inlineEmpty} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={styles.loadError} role="alert">
            {error}
          </p>
        ) : null}
        {profile.loading ? <p className={styles.inlineEmpty}>{enUS.addons.loading}</p> : null}
        {!profile.loading && addons.length === 0 ? (
          <p className={styles.inlineEmpty}>{enUS.addons.empty}</p>
        ) : null}
      </div>

      <div className={styles.addonList}>
        {addons.map((addon) => {
          const issue =
            addon.transportIssue ?? addonTransportIssue(addon.transportUrl, import.meta.env.DEV);
          return (
            <div className={styles.addonRow} key={addon.transportUrl}>
              {!issue && addon.manifest.logo ? (
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
                {addon.manifest.behaviorHints.configurationRequired ? (
                  <p role="status">{enUS.addons.configurationRequired}</p>
                ) : null}
                {issue ? <p role="status">{enUS.addons.transportIssues[issue]}</p> : null}
                <span className={styles.addonTypes}>
                  {addon.manifest.types.join(' · ') || addon.manifest.id}
                </span>
              </div>
              <div className={styles.addonActions}>
                {!issue ? configurationLink(addon) : null}
                {addon.flags.protected ? (
                  <span className={styles.addonBadge}>{enUS.addons.protectedAddon}</span>
                ) : (
                  <button
                    aria-label={enUS.addons.removeTitle(addon.manifest.name)}
                    className={styles.addonRemove}
                    disabled={busy}
                    onClick={() => uninstall(addon)}
                    type="button"
                  >
                    <Trash aria-hidden size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
