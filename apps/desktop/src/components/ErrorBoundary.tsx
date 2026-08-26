import { Component, type ErrorInfo, type ReactNode } from 'react';

import logo from '../assets/kino.svg';
import { t as enUS } from '../locales';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Kino render failure', { error, componentStack: info.componentStack });
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className={styles.root}>
          <img className={styles.logo} src={logo} alt="" />
          <h1>{enUS.errors.title}</h1>
          <button type="button" onClick={() => window.location.reload()}>
            {enUS.errors.retry}
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
