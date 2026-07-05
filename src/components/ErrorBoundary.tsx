import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Catches render/runtime errors in the content area so a crash shows a
 *  recoverable panel instead of a blank window. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("DownMan UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full grid place-items-center p-6 text-center">
          <div className="max-w-md">
            <div className="text-lg font-semibold text-rose-300">Something went wrong</div>
            <div className="mt-2 text-sm text-slate-400 break-words">{this.state.error.message}</div>
            <button className="btn-primary mt-4" onClick={() => this.setState({ error: null })}>
              Reload view
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
