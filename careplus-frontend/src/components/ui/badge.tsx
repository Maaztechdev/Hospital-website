import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold font-[var(--font-data)]",
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
        accent: "bg-[var(--color-accent-light)] text-[var(--color-accent-dark)]",
        emergency: "bg-[var(--color-emergency-light)] text-[var(--color-emergency-dark)]",
        neutral: "bg-slate-100 text-[var(--color-ink-soft)]",
        outline: "border border-[var(--color-border-soft)] text-[var(--color-ink-soft)]",
      },
    },
    defaultVariants: { variant: "primary" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
