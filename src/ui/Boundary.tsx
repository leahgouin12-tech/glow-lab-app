import { Component, type ReactNode } from 'react';

/**
 * Last line of defence, used twice: once around the whole app and once around
 * the department currently in the outlet. The inner one means a broken
 * department cannot brick the shell — the rail, search and breadcrumbs keep
 * working, and moving to another department remounts this boundary (the outlet
 * is keyed by department id), so the error clears itself.
 */
export default class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="gl-page">
        <div className="gl-note gl-note--danger">
          <b>The Glow Lab hit an unexpected error.</b>
          <p className="gl-small">{this.state.error.message}</p>
          <p className="gl-small gl-muted">Your data lives locally and is unaffected. Navigation still works — leave this department, or reload the app.</p>
          <div className="gl-row gl-row--tight">
            <button className="gl-btn gl-btn--primary gl-btn--sm" onClick={() => window.location.reload()}>
              Reload the app
            </button>
            <a className="gl-btn gl-btn--ghost gl-btn--sm" href="#/home">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
