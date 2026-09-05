import { X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { CoreRecovery } from './CoreRecovery';
import logo from '../assets/kino.svg';
import styles from '../App.module.css';
import { useCore } from '../core/context';
import type { CoreRuntimeEvent } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { nativeShellPresent, openAccountCreation } from '../native/player';

function authError(event: CoreRuntimeEvent) {
  return event.name === 'CoreEvent' && event.args.event === 'Error';
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

  const close = useCallback(() => {
    if (!user) selectSession('guest');
    onClose();
  }, [onClose, selectSession, user]);

  useEffect(() => {
    if (session === 'guest') selectSession('account');
  }, [selectSession, session]);

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
    else if (signedIn || status !== 'ready') closeRef.current?.focus();
    else emailRef.current?.focus();
  }, [signedIn, status, submitting]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!transport || status !== 'ready') return;
    setError(null);
    setSubmitting(true);

    try {
      await new Promise<void>((resolve, reject) => {
        let unsubscribe: () => void = () => undefined;
        const timeout = window.setTimeout(() => {
          unsubscribe();
          reject(new Error('Sign-in timed out.'));
        }, 20_000);
        unsubscribe = transport.subscribe((coreEvent) => {
          if (coreEvent.name === 'CoreEvent' && coreEvent.args.event === 'UserAuthenticated') {
            window.clearTimeout(timeout);
            unsubscribe();
            resolve();
          } else if (authError(coreEvent)) {
            window.clearTimeout(timeout);
            unsubscribe();
            reject(new Error('Stremio did not accept those credentials.'));
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
            reject(dispatchError instanceof Error ? dispatchError : new Error('Sign-in failed.'));
          });
      });
      setPassword('');
      onClose();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Sign-in failed.');
    } finally {
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
        aria-label="Close"
        className={styles.dialogClose}
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
          <h1 id="account-title">Stremio account</h1>
          <p>{user.email || user.name || 'Signed in'}</p>
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
            Sign out
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <h1 id="account-title">Sign in to Stremio</h1>
          <p>Your credentials go directly to Stremio. Kino keeps guest activity separate.</p>
          <label htmlFor="stremio-email">Email</label>
          <input
            autoComplete="username"
            aria-describedby={error ? 'account-error' : undefined}
            disabled={status !== 'ready' || submitting}
            id="stremio-email"
            ref={emailRef}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label htmlFor="stremio-password">Password</label>
          <input
            aria-describedby={error ? 'account-error' : undefined}
            autoComplete="current-password"
            disabled={status !== 'ready' || submitting}
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
            disabled={status !== 'ready' || submitting}
            type="submit"
          >
            {status === 'error'
              ? enUS.core.accountUnavailable
              : status !== 'ready'
                ? 'Preparing account…'
                : submitting
                  ? 'Signing in…'
                  : 'Sign in'}
          </button>
          <a
            aria-describedby={creationError ? 'account-creation-error' : undefined}
            aria-disabled={openingRegistration || undefined}
            className={styles.accountCreate}
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
