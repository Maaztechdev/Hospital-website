import * as React from "react"
import { X, User, Stethoscope, CalendarClock, ArrowRightLeft, LogOut, Wrench, Sparkles, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Bed } from "@/dashboard/types"
import { BED_STATUS_META } from "@/dashboard/components/ward/BedTile"
import { formatDateTime } from "@/dashboard/lib/format"

export function BedDetailDrawer({
  bed,
  onClose,
  onTransfer,
  onDischarge,
  onMarkClean,
  onMarkMaintenance,
  canManageBeds,
  canTakePayments,
  onAddDeposit,
}: {
  bed: Bed | null
  onClose: () => void
  onTransfer: (bed: Bed) => void
  onDischarge: (bed: Bed) => void
  onMarkClean: (bed: Bed) => void
  onMarkMaintenance: (bed: Bed) => void
  canManageBeds: boolean
  canTakePayments: boolean
  onAddDeposit: (bed: Bed) => void
}) {
  React.useEffect(() => {
    if (!bed) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [bed, onClose])

  if (!bed) return null
  const meta = BED_STATUS_META[bed.status]
  const Icon = meta.icon

  return (
    <div className="fixed inset-0 z-[95] flex justify-end">
      <div className="animate-[cp-fade-in_0.18s_ease-out] fixed inset-0 bg-[var(--cp-ink)]/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="animate-[cp-slide-in_0.22s_cubic-bezier(0.16,1,0.3,1)] relative flex h-full w-full max-w-sm flex-col overflow-hidden border-l border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-[var(--cp-border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", meta.bg, meta.tone)}>
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="cp-tabular text-base font-bold text-[var(--cp-ink)]">{bed.bedNumber}</p>
              <p className={cn("text-xs font-semibold", meta.tone)}>{bed.status}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--cp-ink-faint)] hover:bg-[var(--cp-bg)] hover:text-[var(--cp-ink)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto cp-scrollbar px-5 py-4">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--cp-ink-soft)]">Ward</dt>
              <dd className="font-medium text-[var(--cp-ink)]">{bed.ward}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--cp-ink-soft)]">Room</dt>
              <dd className="font-medium text-[var(--cp-ink)]">{bed.room}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--cp-ink-soft)]">Daily Rate</dt>
              <dd className="cp-tabular font-medium text-[var(--cp-ink)]">Rs. {bed.dailyRate.toLocaleString()}</dd>
            </div>
          </dl>

          {bed.status === "Occupied" && bed.patientName ? (
            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface-warm)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-faint)]">Current Patient</p>
              <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><User className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {bed.patientName} <span className="cp-tabular text-xs text-[var(--cp-ink-soft)]">({bed.mrNumber})</span></div>
              <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><Stethoscope className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {bed.doctorName}</div>
              {bed.admittedAt && <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><CalendarClock className="h-4 w-4 text-[var(--cp-ink-faint)]" /> Admitted {formatDateTime(bed.admittedAt)}</div>}
              {bed.depositPending && <p className="inline-flex w-fit rounded-full bg-[var(--cp-warning-light)] px-2 py-1 text-xs font-semibold text-[var(--cp-warning)]">Deposit pending</p>}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-[var(--cp-border-strong)] p-4 text-center text-sm text-[var(--cp-ink-soft)]">
              {bed.status === "Available" ? "This bed is free and ready for a new admission." : `This bed is currently ${bed.status.toLowerCase()}.`}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--cp-border)] px-5 py-4">
          {bed.status === "Occupied" && (
            <>
              {bed.depositPending && canTakePayments && <Button size="sm" variant="outline" onClick={() => onAddDeposit(bed)}>Add deposit</Button>}
              <Button size="sm" variant="outline" onClick={() => onTransfer(bed)}><ArrowRightLeft className="h-4 w-4" /> Transfer Patient</Button>
              <Button size="sm" variant="emergency" onClick={() => onDischarge(bed)}><LogOut className="h-4 w-4" /> Discharge Patient</Button>
            </>
          )}
          {canManageBeds && bed.status === "Cleaning" && (
            <Button size="sm" onClick={() => onMarkClean(bed)}><CheckCircle2 className="h-4 w-4" /> Mark as Available</Button>
          )}
          {canManageBeds && bed.status === "Available" && (
            <Button size="sm" variant="outline" onClick={() => onMarkMaintenance(bed)}><Wrench className="h-4 w-4" /> Send for Maintenance</Button>
          )}
          {canManageBeds && bed.status === "Maintenance" && (
            <Button size="sm" onClick={() => onMarkClean(bed)}><Sparkles className="h-4 w-4" /> Return to Service</Button>
          )}
        </div>
      </div>
    </div>
  )
}
