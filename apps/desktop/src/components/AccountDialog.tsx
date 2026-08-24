import { X } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import logo from '../assets/kino.svg';
import styles from '../App.module.css';
import { useCore } from '../core/context';
import type { CoreRuntimeEvent, ProfileState } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';

function authError(event: CoreRuntimeEvent) {
  return event.name === 'CoreEvent' && event.args.event === 'Error';
}

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { selectSession, session, status, transport } = useCore();
  const profile = useCoreModel<ProfileState>('ctx', null, `account:${session}`);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const user = profile.state?.profile.auth?.user;

  const close = useCallback(() => {
    if (!user) selectSession('guest');
    onClose();
  }, [onClose, selectSession, user]);

  useEffect(() => {
    if (session === 'guest') selectSession('account');
  }, [selectSession, session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, submitting]);

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
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        aria-labelledby="account-title"
        aria-modal="true"
        className={styles.accountDialog}
        role="dialog"
      >
        <button
          aria-label="Close"
          className={styles.dialogClose}
          disabled={submitting}
          onClick={close}
          type="button"
        >
          <X aria-hidden size={18} />
        </button>
        <img alt="" src={logo} />
        {user ? (
          <>
            <h1 id="account-title">Stremio account</h1>
            <p>{user.email || user.name || 'Signed in'}</p>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                if (!transport) return;
                void transport
                  .dispatch({ action: 'Ctx', args: { action: 'Logout' } })
                  .finally(() => {
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
              autoFocus
              disabled={status !== 'ready' || submitting}
              id="stremio-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            <label htmlFor="stremio-password">Password</label>
            <input
              autoComplete="current-password"
              disabled={status !== 'ready' || submitting}
              id="stremio-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {error ? <p className={styles.formError}>{error}</p> : null}
            <button
              className={styles.primaryAction}
              disabled={status !== 'ready' || submitting}
              type="submit"
            >
              {status !== 'ready' ? 'Preparing account…' : submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
