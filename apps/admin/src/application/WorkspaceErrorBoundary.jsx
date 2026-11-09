import { Component } from 'react';
import { Button } from '../components/ui/button';
/** Keep a rendering failure recoverable without exposing records or component internals. */
export default class WorkspaceErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="grid min-h-svh place-items-center bg-background p-6"><section role="alert" className="max-w-md space-y-4 rounded-xl border bg-card p-8 text-center shadow-sm"><h1 className="text-xl font-semibold">This workspace could not be displayed</h1><p className="text-sm text-muted-foreground">Reload to retrieve the current saved records. Any unsaved form changes will be lost.</p><Button onClick={() => window.location.reload()}>Reload workspace</Button></section></div>;
  }
}
