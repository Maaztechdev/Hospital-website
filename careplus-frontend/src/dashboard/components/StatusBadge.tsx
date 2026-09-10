import { cn } from "@/lib/utils"

export type SemanticTone = "success" | "warning" | "critical" | "info" | "neutral" | "accent"

// One shared status → tone map used by every module (appointments, lab,
// pharmacy, billing, admissions) so colors never drift between screens.
const STATUS_TONE: Record<string, SemanticTone> = {
  // Appointments / OPD
  "Pending Approval": "warning",
  "Confirmed": "info",
  "Waiting": "warning",
  "In Consultation": "accent",
  "Done": "success",
  "Cancelled": "neutral",
  "No-show": "critical",
  // Lab
  "Ordered": "info",
  "Sample Collected": "warning",
  "Processing": "accent",
  "Completed": "success",
  "Verified": "success",
  "Normal": "success",
  "High": "warning",
  "Low": "warning",
  "Critical": "critical",
  // Pharmacy / Inventory
  "In Stock": "success",
  "Low Stock": "warning",
  "Out of Stock": "critical",
  "Near Expiry": "warning",
  // Billing
  "Paid": "success",
  "Partial": "warning",
  "Unpaid": "critical",
  "Void": "neutral",
  // Patients / generic
  "Active": "success",
  "Inactive": "neutral",
  // Priority
  "Routine": "info",
  "Urgent": "warning",
  "Emergency": "critical",
  // Prescription
  "Draft": "warning",
  "Signed": "success",
}

const TONE_CLASSES: Record<SemanticTone, string> = {
  success: "bg-[var(--cp-success-light)] text-[var(--cp-success)]",
  warning: "bg-[var(--cp-warning-light)] text-[var(--cp-warning)]",
  critical: "bg-[var(--cp-critical-light)] text-[var(--cp-critical)]",
  info: "bg-[var(--cp-info-light)] text-[var(--cp-info)]",
  neutral: "bg-[var(--cp-neutral-light)] text-[var(--cp-neutral)]",
  accent: "bg-[var(--cp-accent-light)] text-[var(--cp-accent)]",
}

const TONE_DOT: Record<SemanticTone, string> = {
  success: "bg-[var(--cp-success)]",
  warning: "bg-[var(--cp-warning)]",
  critical: "bg-[var(--cp-critical)]",
  info: "bg-[var(--cp-info)]",
  neutral: "bg-[var(--cp-neutral)]",
  accent: "bg-[var(--cp-accent)]",
}

export function toneFor(status: string): SemanticTone {
  return STATUS_TONE[status] ?? "neutral"
}

export function StatusBadge({ status, tone, className }: { status: string; tone?: SemanticTone; className?: string }) {
  const t = tone ?? toneFor(status)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        TONE_CLASSES[t],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[t])} />
      {status}
    </span>
  )
}

// The signature "status strip" — a colored left-edge bar used on record rows
// (appointments, lab orders, invoices, admissions) so state reads at a glance.
export function StatusStrip({ status, tone, className }: { status: string; tone?: SemanticTone; className?: string }) {
  const t = tone ?? toneFor(status)
  const bg: Record<SemanticTone, string> = {
    success: "bg-[var(--cp-success)]",
    warning: "bg-[var(--cp-warning)]",
    critical: "bg-[var(--cp-critical)]",
    info: "bg-[var(--cp-info)]",
    neutral: "bg-[var(--cp-neutral)]",
    accent: "bg-[var(--cp-accent)]",
  }
  return <span className={cn("absolute left-0 top-0 h-full w-1 rounded-l-xl", bg[t], className)} />
}
