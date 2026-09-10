import * as React from "react"
import { BedDouble, CheckCircle2, UserRound, Clock3, Sparkles, Wrench, Percent, Plus, History } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { BedBoard } from "@/dashboard/components/ward/BedBoard"
import { SkeletonBedBoard } from "@/dashboard/components/Primitives"
import { BedDetailDrawer } from "@/dashboard/components/ward/BedDetailDrawer"
import { AdmitPatientModal } from "@/dashboard/pages/ward/AdmitPatientModal"
import { TransferModal } from "@/dashboard/pages/ward/TransferModal"
import { DischargeModal } from "@/dashboard/pages/ward/DischargeModal"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { bedsSummary } from "@/dashboard/data/wardData"
import { formatDateTime } from "@/dashboard/lib/format"
import type { Bed } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"

export default function WardDashboard() {
  const { beds, transfers, refreshWardState } = useDashboard()
  const { toast } = useToast()
  const [drawerBed, setDrawerBed] = React.useState<Bed | null>(null)
  const [admitOpen, setAdmitOpen] = React.useState(false)
  const [transferBed, setTransferBed] = React.useState<Bed | null>(null)
  const [dischargeBed, setDischargeBed] = React.useState<Bed | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 450)
    return () => clearTimeout(t)
  }, [])

  const summary = bedsSummary(beds)

  // keep drawer bed fresh as global state changes (e.g. after transfer/discharge)
  const liveDrawerBed = drawerBed ? beds.find((b) => b.id === drawerBed.id) ?? null : null

  async function updateBedStatus(bed: Bed, status: "AVAILABLE" | "MAINTENANCE") {
    try {
      await api.setBedStatus(bed.id, status)
      await refreshWardState()
      toast({ title: "Bed updated", description: `${bed.bedNumber} is now ${status === "AVAILABLE" ? "Available" : "Maintenance"}.`, variant: "success" })
      setDrawerBed(null)
    } catch (error) {
      toast({ title: "Bed update failed", description: error instanceof Error ? error.message : "Unable to update bed.", variant: "error" })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Ward & Bed Management"
        action={<Button size="sm" onClick={() => setAdmitOpen(true)}><Plus className="h-4 w-4" /> Admit Patient</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard label="Total Beds" value={summary.total.toString()} icon={BedDouble} tone="primary" />
        <StatCard label="Occupied" value={summary.occupied.toString()} icon={UserRound} tone="critical" />
        <StatCard label="Available" value={summary.available.toString()} icon={CheckCircle2} tone="success" />
        <StatCard label="Reserved" value={summary.reserved.toString()} icon={Clock3} tone="warning" />
        <StatCard label="Cleaning" value={summary.cleaning.toString()} icon={Sparkles} tone="primary" />
        <StatCard label="Maintenance" value={summary.maintenance.toString()} icon={Wrench} tone="warning" />
        <StatCard label="Occupancy" value={`${summary.occupancyPct}%`} icon={Percent} tone="primary" />
        <StatCard label="Admissions" value={summary.occupied.toString()} icon={BedDouble} tone="success" />
      </div>

      {loading ? <SkeletonBedBoard count={16} /> : <BedBoard beds={beds} onSelectBed={(b) => setDrawerBed(b)} />}

      {transfers.length > 0 && (
        <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-[var(--cp-ink)]"><History className="h-4 w-4" /> Recent Transfers</p>
          <div className="cp-scrollbar flex gap-3 overflow-x-auto pb-1">
            {transfers.map((t) => (
              <div key={t.id} className="flex min-w-[220px] shrink-0 flex-col gap-1 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface-warm)] p-3">
                <p className="text-xs font-semibold text-[var(--cp-ink)]">{t.patientName}</p>
                <p className="cp-tabular text-xs text-[var(--cp-ink-soft)]">{t.fromBedNumber} → {t.toBedNumber}</p>
                <p className="text-[11px] text-[var(--cp-ink-faint)]">{formatDateTime(t.date)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <BedDetailDrawer
        bed={liveDrawerBed}
        onClose={() => setDrawerBed(null)}
        onTransfer={(b) => { setDrawerBed(null); setTransferBed(b) }}
        onDischarge={(b) => { setDrawerBed(null); setDischargeBed(b) }}
        onMarkClean={(b) => { void updateBedStatus(b, "AVAILABLE") }}
        onMarkMaintenance={(b) => { void updateBedStatus(b, "MAINTENANCE") }}
      />

      <AdmitPatientModal open={admitOpen} onClose={() => setAdmitOpen(false)} />
      <TransferModal bed={transferBed} onClose={() => setTransferBed(null)} />
      <DischargeModal bed={dischargeBed} onClose={() => setDischargeBed(null)} />
    </div>
  )
}
