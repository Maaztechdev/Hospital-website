import * as React from "react"
import { Button } from "@/components/ui/button"

interface ErrorBoundaryState { error: Error | null }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error } }

  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error("Unhandled UI error", error, info) }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--cp-bg)] px-6 text-center">
        <div role="alert" className="max-w-md rounded-xl border border-[var(--cp-critical)] bg-[var(--cp-surface)] p-8">
          <h1 className="mb-2 text-xl font-bold text-[var(--cp-ink)]">This section could not load</h1>
          <p className="mb-5 text-sm text-[var(--cp-ink-soft)]">An unexpected error occurred. Reload the section to continue.</p>
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      </main>
    )
  }
}