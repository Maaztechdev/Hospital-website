import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] shadow-care hover:shadow-care-hover hover:-translate-y-0.5",
        accent:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-dark)] shadow-care hover:shadow-care-hover hover:-translate-y-0.5",
        emergency:
          "bg-[var(--color-emergency)] text-white hover:bg-[var(--color-emergency-dark)] shadow-care hover:shadow-care-hover hover:-translate-y-0.5",
        outline:
          "border border-[var(--color-border-soft)] bg-white text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        ghost:
          "text-[var(--color-ink-soft)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)]",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline p-0",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-14 px-8 text-base",
        icon: "h-11 w-11 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
)
Button.displayName = "Button"

export { Button, buttonVariants }
