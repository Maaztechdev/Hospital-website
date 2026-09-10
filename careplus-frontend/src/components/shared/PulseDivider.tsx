import { useReducedMotion } from "framer-motion"

/**
 * Signature motif: a thin heartbeat/pulse line used as a section divider.
 * Draws once on mount (CSS animation), respects reduced motion.
 */
export function PulseDivider({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion()

  return (
    <div className={`flex w-full items-center justify-center py-2 ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 400 40"
        className="h-8 w-full max-w-xs text-[var(--color-accent)]"
        fill="none"
      >
        <path
          d="M0 20 H140 L155 6 L170 34 L185 20 L200 20 L215 4 L232 36 L248 20 H400"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1000}
          style={
            reduce
              ? undefined
              : {
                  strokeDasharray: 1000,
                  animation: "heartbeat-draw 2.8s ease-in-out 1",
                }
          }
        />
      </svg>
    </div>
  )
}
