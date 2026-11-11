import * as React from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface ErrorBoundaryProps extends React.PropsWithChildren {
  fallbackTitle?: string
  className?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unhandled UI error", error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        className={`my-4 flex flex-col items-center justify-center rounded-xl border border-[var(--cp-critical)]/30 bg-[var(--cp-surface)] p-6 text-center shadow-sm ${this.props.className ?? ""}`}
      >
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mb-1 text-base font-semibold text-[var(--cp-ink)]">
          {this.props.fallbackTitle ?? "This section could not load"}
        </h2>
        <p className="mb-4 max-w-md text-xs text-[var(--cp-ink-soft)]">
          {this.state.error.message || "An unexpected error occurred. Click retry to recover."}
        </p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          Retry
        </Button>
      </div>
    )
  }
}