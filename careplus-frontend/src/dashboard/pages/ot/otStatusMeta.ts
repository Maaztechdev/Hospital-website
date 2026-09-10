import type { OTStatus } from "@/dashboard/types"

export const OT_STATUS_META: Record<OTStatus, { bg: string; tone: string; dot: string }> = {
  Scheduled: { bg: "bg-[var(--cp-info-light)]", tone: "text-[var(--cp-info)]", dot: "bg-[var(--cp-info)]" },
  "Pre-op": { bg: "bg-[var(--cp-warning-light)]", tone: "text-[var(--cp-warning)]", dot: "bg-[var(--cp-warning)]" },
  "In Progress": { bg: "bg-[var(--cp-critical-light)]", tone: "text-[var(--cp-critical)]", dot: "bg-[var(--cp-critical)]" },
  Recovery: { bg: "bg-[var(--cp-success-light)]", tone: "text-[var(--cp-success)]", dot: "bg-[var(--cp-success)]" },
  Completed: { bg: "bg-[var(--cp-neutral-light)]", tone: "text-[var(--cp-neutral)]", dot: "bg-[var(--cp-neutral)]" },
  Cancelled: { bg: "bg-[var(--cp-neutral-light)]", tone: "text-[var(--cp-ink-faint)]", dot: "bg-[var(--cp-ink-faint)]" },
}