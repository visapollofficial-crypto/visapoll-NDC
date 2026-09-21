import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("UI error:", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-screen">
        <h1>Something broke on this page</h1>
        <p className="muted">Reload to try again. If it keeps happening, tell your admin.</p>
        <button className="btn" onClick={() => location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}
