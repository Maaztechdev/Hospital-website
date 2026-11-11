import * as React from "react"
import { Link } from "react-router-dom"
import { Activity, Clock3, DollarSign, FileCheck2, Plus, ScanLine, Users, AlertTriangle, RefreshCw } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { LineChartWidget } from "@/dashboard/components/charts/Charts"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { api, type ApiUltrasoundOverview } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

const statusLabels: Record<string, string> = {
  ORDERED: "Ordered",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  REPORTED: "Reported",
  VERIFIED: "Verified",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
}

const priorityLabels: Record<string, string> = { ROUTINE: "Routine", URGENT: "Urgent", STAT: "STAT", EMERGENCY: "STAT" }

export default function UltrasoundOverviewPage() {
  const { toast } = useToast()
  const [overview, setOverview] = React.useState<ApiUltrasoundOverview | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setOverview(await api.getUltrasoundOverview())
    } catch (cause) {
      toast({ title: "Unable to load Ultrasound overview", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  const stats = overview?.stats
  const cards = [
    { label: "Today's scans", value: stats?.todayScans ?? 0, icon: ScanLine, tone: "text-[var(--cp-primary)]" },
    { label: "Pending", value: stats?.pending ?? 0, icon: Clock3, tone: "text-[var(--cp-warning)]" },
    { label: "In Progress", value: stats?.inProgress ?? 0, icon: Activity, tone: "text-[var(--cp-accent)]" },
    { label: "Awaiting verification", value: stats?.awaitingVerification ?? 0, icon: FileCheck2, tone: "text-[var(--cp-info)]" },
    { label: "Urgent", value: stats?.urgent ?? 0, icon: AlertTriangle, tone: "text-[var(--cp-critical)]" },
    { label: "Today's collected", value: formatCurrency(stats?.todayCollected ?? 0), icon: DollarSign, tone: "text-[var(--cp-success)]" },
  ]

  return <div className="flex flex-col gap-5">
    <DashboardPageHeader title="Ultrasound Overview" action={<div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Refresh</Button>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/dashboard/ultrasound">Open Queue</Link>
    </div>} />

    {loading && <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading Ultrasound metrics…</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ label, value, icon: Icon, tone }) => <Card key={label}><CardContent className="flex items-start justify-between p-4">
        <div><p className="text-xs font-medium text-[var(--cp-ink-soft)]">{label}</p><p className="mt-1 text-2xl font-bold text-[var(--cp-ink)]">{value}</p></div>
        <span className={`rounded-xl bg-[var(--cp-bg)] p-2 ${tone}`}><Icon className="h-5 w-5" /></span>
      </CardContent></Card>)}
    </div>

    <Card><CardHeader><CardTitle>Quick actions</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-3">
      <Link className={buttonVariants()} to="/dashboard/ultrasound?new=1"><Plus className="h-4 w-4" />New Order</Link>
      <Link className={buttonVariants({ variant: "outline" })} to="/dashboard/patients"><Users className="h-4 w-4" />Patients</Link>
      <Link className={buttonVariants({ variant: "outline" })} to="/dashboard/ultrasound/reports"><FileCheck2 className="h-4 w-4" />Reports</Link>
    </CardContent></Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Scans per day · last 7 days</CardTitle></CardHeader><CardContent>
        {overview?.scansPerDay.length ? <LineChartWidget data={overview.scansPerDay.map((point) => ({
          label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${point.day}T00:00:00Z`)),
          value: point.count,
        }))} /> : <p className="flex h-[200px] items-center justify-center text-sm text-[var(--cp-ink-soft)]">No scans in this timeframe.</p>}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Recent activity</CardTitle></CardHeader><CardContent>
        {overview?.recentActivity.length ? <div className="divide-y divide-[var(--cp-border)]">
          {overview.recentActivity.map((item) => <Link key={item.id} to={`/dashboard/ultrasound?orderId=${encodeURIComponent(item.id)}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div><p className="text-sm font-semibold">{item.patient.firstName} {item.patient.lastName} <span className="font-normal text-[var(--cp-ink-soft)]">· {item.examType}</span></p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{item.patient.mrNumber} · {formatDateTime(item.updatedAt)}</p></div>
            <div className="flex gap-2"><StatusBadge status={priorityLabels[item.priority] ?? item.priority} /><StatusBadge status={statusLabels[item.status] ?? item.status} /></div>
          </Link>)}
        </div> : <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">{loading ? "Loading recent scans…" : "No scans in this timeframe."}</p>}
      </CardContent></Card>
    </div>
  </div>
}
