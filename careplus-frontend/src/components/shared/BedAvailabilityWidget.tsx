import { motion, useReducedMotion } from "framer-motion"
import { useEffect, useState } from "react"
import { BedDouble } from "lucide-react"
import { bedAvailability } from "@/data/beds"
import { Card } from "@/components/ui/card"

export function BedAvailabilityWidget() {
  const reduce = useReducedMotion()
  const totalBeds = bedAvailability.reduce((s, b) => s + b.total, 0)
  const totalOccupied = bedAvailability.reduce((s, b) => s + b.occupied, 0)
  const totalAvailable = totalBeds - totalOccupied
  const [availableCount, setAvailableCount] = useState(reduce ? totalAvailable : 0)

  useEffect(() => {
    if (reduce) {
      setAvailableCount(totalAvailable)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 1200, 1)
      setAvailableCount(Math.round((1 - Math.pow(1 - progress, 3)) * totalAvailable))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduce, totalAvailable])

  return (
    <Card
      className={`relative overflow-hidden p-6 ${reduce ? "" : "animate-[pulse-glow_2.4s_ease-in-out_infinite]"}`}
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] ${reduce ? "" : "animate-ping"} opacity-60`}
            />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
          </span>
          <span className="font-[var(--font-data)] text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-dark)]">
            Live bed availability
          </span>
        </div>
        <BedDouble className="h-5 w-5 text-[var(--color-primary)]" />
      </div>

      <div className="mb-5">
        <motion.div
          key={totalAvailable}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="font-[var(--font-data)] text-4xl font-bold text-[var(--color-ink)]"
        >
          {availableCount}{" "}
          <span className="text-base font-medium text-[var(--color-ink-soft)]">
            beds available now
          </span>
        </motion.div>
      </div>

      <div className="space-y-3">
        {bedAvailability.map((cat) => {
          const pct = Math.round((cat.occupied / cat.total) * 100)
          const available = cat.total - cat.occupied
          return (
            <div key={cat.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--color-ink-soft)]">{cat.label}</span>
                <span className="font-[var(--font-data)] text-[var(--color-ink)]">
                  {available} open
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-primary-light)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full bg-[var(--color-primary)]"
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
