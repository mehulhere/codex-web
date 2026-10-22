import React from "react";
import { reportClientError } from "@/lib/client-error-logger";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export class FrontendErrorBoundary extends React.Component<Props, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    reportClientError(error, "react-error-boundary", {
      componentStack: info.componentStack ?? ""
    });
  }

  public override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <section className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Codex Mobile needs to reload</h1>
          <p className="text-sm text-muted-foreground">
            The frontend hit a rendering error. It was logged automatically.
          </p>
          <button
            type="button"
            className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
            onClick={() => window.location.reload()}
          >
            Reload PWA
          </button>
        </section>
      </main>
    );
  }
}
