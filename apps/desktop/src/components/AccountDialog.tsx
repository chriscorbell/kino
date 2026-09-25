import { X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { CoreRecovery } from './CoreRecovery';
import logo from '../assets/kino.svg';
import styles from '../styles/shared.module.css';
import settingsStyles from '../styles/settings.module.css';
import { useCore } from '../core/context';
import { coreFailureMessage } from '../core/errors';
import { createCoreTransport, type CoreTransport } from '../core/transport';
import type { CoreRuntimeEvent } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { nativeShellPresent, openAccountCreation } from '../native/player';

function authError(event: CoreRuntimeEvent) {
  return event.name === 'CoreEvent' && event.args.event === 'Error';
}

function authenticate(transport: CoreTransport, email: string, password: string) {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(enUS.account.timeout));
    }, 20_000);
    unsubscribe = transport.subscribe((coreEvent) => {
      if (coreEvent.name === 'CoreEvent' && coreEvent.args.event === 'UserAuthenticated') {
        window.clearTimeout(timeout);
        unsubscribe();
        resolve();
      } else if (authError(coreEvent)) {
        window.clearTimeout(timeout);
        unsubscribe();
        reject(new Error(enUS.account.rejected));
      }
    });
    void transport
      .dispatch({
        action: 'Ctx',
        args: {
          action: 'Authenticate',
          args: { type: 'Login', email, password },
        },
      })
      .catch((dispatchError: unknown) => {
        window.clearTimeout(timeout);
        unsubscribe();
        reject(dispatchError instanceof Error ? dispatchError : new Error(enUS.account.failed));
      });
  });
}

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { selectSession, session, status, transport } = useCore();
  const profile = useCoreModel('ctx', null, `account:${session}`);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creationError, setCreationError] = useState(false);
  const [openingRegistration, setOpeningRegistration] = useState(false);
  const user = profile.state?.profile.auth?.user;
  const signedIn = Boolean(user);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Guest browsing keeps its own Core while the dialog is open. Only a
  // completed sign-in switches the app to the account profile.
  const accountCore = session === 'account';
  const formReady = !accountCore || status === 'ready';
  const signInCore = useRef<CoreTransport | null>(null);

  const close = useCallback(() => {
    if (accountCore && !user) selectSession('guest');
    onClose();
  }, [accountCore, onClose, selectSession, user]);

  useEffect(
    () => () => {
      void signInCore.current?.destroy().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (submitting) dialogRef.current?.focus();
    else if (signedIn || !formReady) closeRef.current?.focus();
    else emailRef.current?.focus();
  }, [formReady, signedIn, submitting]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !formReady) return;
    setError(null);
    setSubmitting(true);

    try {
      if (accountCore && transport) {
        await authenticate(transport, email, password);
      } else {
        // A separate account Core signs in and saves the session. Its
        // shutdown flushes that save before the app opens the account profile.
        const core = createCoreTransport('account');
        signInCore.current = core;
        await core.init();
        await authenticate(core, email, password);
        signInCore.current = null;
        await core.destroy();
        selectSession('account');
      }
      setPassword('');
      onClose();
    } catch (signInError) {
      setError(coreFailureMessage(signInError, enUS.account.failed));
    } finally {
      void signInCore.current?.destroy().catch(() => undefined);
      signInCore.current = null;
      setSubmitting(false);
    }
  };

  return (
    <dialog
      aria-labelledby="account-title"
      aria-modal="true"
      className={styles.accountDialog}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href]',
          ),
        ).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) close();
      }}
    >
      <button
        aria-label={enUS.actions.close}
        className={settingsStyles.dialogClose}
        disabled={submitting}
        onClick={close}
        ref={closeRef}
        type="button"
      >
        <X aria-hidden size={18} />
      </button>
      <img alt="" src={logo} />
      <CoreRecovery onGuest={onClose} />
      {user ? (
        <>
          <h1 id="account-title">{enUS.account.title}</h1>
          <p>{user.email || user.name || enUS.account.signedIn}</p>
          <button
            className={styles.secondaryAction}
            onClick={() => {
              if (!transport) return;
              void transport.dispatch({ action: 'Ctx', args: { action: 'Logout' } }).finally(() => {
                selectSession('guest');
                onClose();
              });
            }}
            type="button"
          >
            {enUS.account.signOut}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <h1 id="account-title">{enUS.account.signInTitle}</h1>
          <p>{enUS.account.description}</p>
          <label htmlFor="stremio-email">{enUS.account.email}</label>
          <input
            autoComplete="username"
            aria-describedby={error ? 'account-error' : undefined}
            disabled={!formReady || submitting}
            id="stremio-email"
            ref={emailRef}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label htmlFor="stremio-password">{enUS.account.password}</label>
          <input
            aria-describedby={error ? 'account-error' : undefined}
            autoComplete="current-password"
            disabled={!formReady || submitting}
            id="stremio-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error ? (
            <p className={styles.formError} id="account-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className={styles.primaryAction}
            disabled={!formReady || submitting}
            type="submit"
          >
            {accountCore && status === 'error'
              ? enUS.core.accountUnavailable
              : !formReady
                ? enUS.account.preparing
                : submitting
                  ? enUS.account.submitting
                  : enUS.account.signIn}
          </button>
          <a
            aria-describedby={creationError ? 'account-creation-error' : undefined}
            aria-disabled={openingRegistration || undefined}
            className={settingsStyles.accountCreate}
            href="https://www.stremio.com/register"
            onClick={(event) => {
              if (!nativeShellPresent()) return;
              event.preventDefault();
              if (openingRegistration) return;
              setCreationError(false);
              setOpeningRegistration(true);
              void openAccountCreation()
                .catch(() => setCreationError(true))
                .finally(() => setOpeningRegistration(false));
            }}
            rel="noopener noreferrer"
            target="_blank"
          >
            {enUS.account.create}
          </a>
          {creationError ? (
            <p className={styles.formError} id="account-creation-error" role="alert">
              {enUS.account.createFailed}
            </p>
          ) : null}
        </form>
      )}
    </dialog>
  );
}
