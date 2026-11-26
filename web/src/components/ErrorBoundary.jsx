import { Component } from 'react';

/**
 * If a panel throws while rendering, show a small message in its place
 * instead of unmounting the whole app (which leaves a blank page).
 * It resets automatically when `resetKey` changes (i.e. new input).
 */
export default class ErrorBoundary extends Component {
  state = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    console.error('Panel crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <strong>This panel hit an error.</strong>
        <code>{String(this.state.error.message || this.state.error)}</code>
        <button type="button" className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
