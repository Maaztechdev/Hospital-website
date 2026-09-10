import { useEffect, useRef, useState } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"

export function StatCounter({
  value,
  suffix = "",
  label,
}: {
  value: number
  suffix?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const reduce = useReducedMotion()
  const [count, setCount] = useState(reduce ? value : 0)

  useEffect(() => {
    if (!inView || reduce) return
    const duration = 1200
    const start = performance.now()
    let raf: number
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * value))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value, reduce])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      className="text-center"
    >
      <div className="font-[var(--font-data)] text-3xl font-bold text-[var(--color-primary)] sm:text-4xl">
        {count}
        {suffix}
      </div>
      <div className="mt-1 text-sm text-[var(--color-ink-soft)]">{label}</div>
    </motion.div>
  )
}
