import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border bg-white px-4 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:border-[var(--color-accent)]",
        error ? "border-[var(--color-emergency)]" : "border-[var(--color-border-soft)]",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }
