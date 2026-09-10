import { motion } from "framer-motion"
import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <section className="border-b border-[var(--color-border-soft)] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          {eyebrow && (
            <span className="mb-3 inline-block font-[var(--font-data)] text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)]">
              {eyebrow}
            </span>
          )}
          <h1 className="text-balance text-3xl font-bold text-[var(--color-ink)] sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {description && (
            <p className="mt-4 text-base leading-relaxed text-[var(--color-ink-soft)] sm:text-lg">
              {description}
            </p>
          )}
          {children}
        </motion.div>
      </div>
    </section>
  )
}
