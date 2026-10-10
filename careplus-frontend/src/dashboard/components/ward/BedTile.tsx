import * as React from "react"
import { Check, CheckCircle2, UserRound, Clock3, Wrench, Sparkles, BedDouble } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Bed, BedStatus } from "@/dashboard/types"
import { Button } from "@/components/ui/button"
import { formatDate, getHospitalDateKeyForTimestamp } from "@/dashboard/lib/format"

export const BED_STATUS_META: Record<BedStatus, { icon: typeof Check; tone: string; bg: string; ring: string }> = {
  Available: { icon: Check, tone: "text-[var(--cp-success)]", bg: "bg-[var(--cp-success-light)]", ring: "border-[var(--cp-success)]/30" },
  Occupied: { icon: UserRound, tone: "text-[var(--cp-critical)]", bg: "bg-[var(--cp-critical-light)]", ring: "border-[var(--cp-critical)]/30" },
  Reserved: { icon: Clock3, tone: "text-[var(--cp-warning)]", bg: "bg-[var(--cp-warning-light)]", ring: "border-[var(--cp-warning)]/30" },
  Cleaning: { icon: Sparkles, tone: "text-[var(--cp-info)]", bg: "bg-[var(--cp-info-light)]", ring: "border-[var(--cp-info)]/30" },
  Maintenance: { icon: Wrench, tone: "text-[var(--cp-neutral)]", bg: "bg-[var(--cp-neutral-light)]", ring: "border-[var(--cp-neutral-light)]" },
}

export function BedTile({
  bed,
  onClick,
  selected,
  dim,
  onMarkAvailable,
  markingAvailable,
}: {
  bed: Bed
  onClick?: (bed: Bed) => void
  selected?: boolean
  dim?: boolean
  onMarkAvailable?: (bed: Bed) => void
  markingAvailable?: boolean
}) {
  const meta = BED_STATUS_META[bed.status]
  const Icon = meta.icon
  const [showTip, setShowTip] = React.useState(false)
  const daysAdmitted = bed.admittedAt
    ? Math.max(0, Math.round((
      new Date(`${getHospitalDateKeyForTimestamp(new Date().toISOString())}T00:00:00Z`).getTime() -
      new Date(`${getHospitalDateKeyForTimestamp(new Date(bed.admittedAt).toISOString())}T00:00:00Z`).getTime()
    ) / 86_400_000))
    : null
  const admittedDuration = daysAdmitted === 0 ? "Today" : `${daysAdmitted} day${daysAdmitted === 1 ? "" : "s"}`

  return (
    <div
      className="relative"
      data-bed-id={bed.id}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <button
        type="button"
        data-bed-id={bed.id}
        onClick={() => onClick?.(bed)}
        disabled={!onClick}
        className={cn(
          "flex w-full flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all duration-200 ease-out",
          meta.bg, meta.ring,
          onClick && "cursor-pointer hover:-translate-y-0.5 hover:cp-shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]",
          !onClick && "cursor-default",
          selected && "ring-2 ring-[var(--cp-primary)]",
          dim && "opacity-40 grayscale"
        )}
      >
        <div className="flex w-full items-center justify-between">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-white/70", meta.tone)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <BedDouble className="h-3.5 w-3.5 text-[var(--cp-ink-faint)]" />
        </div>
        <div className="transition-colors duration-300">
          <p className="cp-tabular text-sm font-bold text-[var(--cp-ink)]">{bed.bedNumber}</p>
          <p className={cn("text-[11px] font-semibold", meta.tone)}>{bed.status}</p>
          {bed.status === "Occupied" && bed.patientName && (
            <div className="mt-1 max-w-full text-[10px] leading-tight text-[var(--cp-ink)]" title={`${bed.patientName}${bed.doctorName ? ` · ${bed.doctorName}` : ""}${admittedDuration ? ` · ${admittedDuration} admitted` : ""}`}>
              <p className="max-w-full truncate font-semibold">{bed.patientName}</p>
              {bed.roundDoneToday && <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--cp-success)]"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--cp-success)]" />Round done today</span>}
              {bed.depositPending && <p className="mt-1 inline-flex rounded bg-[var(--cp-warning-light)] px-1 py-0.5 font-semibold text-[var(--cp-warning)]">Deposit pending</p>}
              {bed.doctorName && <p className="max-w-full truncate">{bed.doctorName}</p>}
              {bed.admittedAt && <p>Admitted {formatDate(bed.admittedAt)}</p>}
              {admittedDuration && <p>{admittedDuration === "Today" ? "Admitted today" : `${admittedDuration} admitted`}</p>}
            </div>
          )}
        </div>
      </button>
      {bed.status === "Cleaning" && onMarkAvailable && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 w-full"
          onClick={() => onMarkAvailable(bed)}
          disabled={markingAvailable}
        >
          <CheckCircle2 className="h-4 w-4" />
          {markingAvailable ? "Updating…" : "Mark as Available"}
        </Button>
      )}
      {showTip && bed.status === "Occupied" && bed.patientName && (
        <div className="pointer-events-none absolute -top-2 left-1/2 z-20 w-max max-w-[180px] -translate-x-1/2 -translate-y-full rounded-lg bg-[var(--cp-ink)] px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xl animate-[cp-fade-in_0.12s_ease-out]">
          {bed.patientName}
          <span className="block text-[10px] font-normal text-white/70">{bed.doctorName}</span>
        </div>
      )}
    </div>
  )
}
