import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}

const COLORS = {
  success: "border-[var(--color-accent)] text-[var(--color-accent-dark)]",
  error: "border-[var(--color-emergency)] text-[var(--color-emergency-dark)]",
  info: "border-[var(--color-primary)] text-[var(--color-primary)]",
}

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col sm:right-5 sm:top-5 sm:w-full">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICONS[t.variant ?? "info"]
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className={`flex items-start gap-3 rounded-2xl border-l-4 bg-white p-4 shadow-care-hover ${COLORS[t.variant ?? "info"]}`}
              role="status"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
