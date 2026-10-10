import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Activity, AlertOctagon, ClipboardList, Clock3, FlaskConical, Plus, TestTubes, Timer, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/dashboard/components/StatCard"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { CreateLabOrderModal } from "@/dashboard/pages/lab/CreateLabOrderModal"
import { formatDateTime } from "@/dashboard/lib/format"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiLabOverview } from "@/lib/api"

const EMPTY: ApiLabOverview = {
  counts: { ordersToday: 0, samplesPending: 0, inProcess: 0, criticalResults: 0, expiringReagents: 0 },
  overdueCount: 0,
  orders: [],
  recentEvents: [],
}

const PRIORITY_ORDER = { EMERGENCY: 0, URGENT: 1, ROUTINE: 2 } as const

function eventLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function LabDashboard() {
  const { currentUser } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [overview, setOverview] = React.useState(EMPTY)
  const [loading, setLoading] = React.useState(true)
  const [createOrderOpen, setCreateOrderOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      setOverview(await api.getLabOverview())
    } catch (error) {
      toast({ title: "Unable to load Lab overview", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  const canCreateOrder = ["admin", "receptionist", "doctor"].includes(currentUser?.role ?? "")
  const canSeeReports = ["admin", "billing_manager", "lab_technician", "pathologist"].includes(currentUser?.role ?? "")
  const sortedOrders = [...overview.orders].sort((left, right) =>
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || Date.parse(left.orderedAt) - Date.parse(right.orderedAt),
  )

  return <div className="flex flex-col gap-5">
    <DashboardPageHeader title="Lab Overview" action={<Button variant="outline" size="sm" onClick={() => navigate("/dashboard/lab/orders")}><ClipboardList className="h-4 w-4" />All orders</Button>} />
    <div className="flex flex-wrap gap-2">
      {canCreateOrder && <Button size="sm" onClick={() => setCreateOrderOpen(true)}><Plus className="h-4 w-4" />New Order</Button>}
      <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/lab/orders?status=PROCESSING")}><TestTubes className="h-4 w-4" />Enter Results</Button>
      {canSeeReports && <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/lab/reports")}><TrendingUp className="h-4 w-4" />Reports</Button>}
    </div>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatCard label="Orders today" value={loading ? "…" : String(overview.counts.ordersToday)} icon={ClipboardList} tone="primary" description="Orders created today in hospital local time." />
      <StatCard label="Samples pending" value={loading ? "…" : String(overview.counts.samplesPending)} icon={TestTubes} tone="warning" description="Orders still waiting for a sample collection." onClick={() => navigate("/dashboard/lab/orders?status=ORDERED")} />
      <StatCard label="In process" value={loading ? "…" : String(overview.counts.inProcess)} icon={Activity} tone="primary" description="Samples collected or currently processing." onClick={() => navigate("/dashboard/lab/orders?status=PROCESSING")} />
      <StatCard label="Critical results" value={loading ? "…" : String(overview.counts.criticalResults)} icon={AlertOctagon} tone="critical" description="Non-cancelled orders flagged with critical results." />
      <StatCard label="Expiring reagents" value={loading ? "…" : String(overview.counts.expiringReagents)} icon={FlaskConical} tone="warning" description="Reagent batches expiring in the next 30 days." onClick={() => navigate("/dashboard/lab/inventory?sort=expiry")} />
    </div>

    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-bold text-[var(--cp-ink)]">Priority work queue</h2><p className="text-xs text-[var(--cp-ink-soft)]">STAT/Emergency and Urgent orders are listed first.</p></div>
        {overview.overdueCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cp-critical-light)] px-3 py-1 text-xs font-semibold text-[var(--cp-critical)]"><Clock3 className="h-3.5 w-3.5" />{overview.overdueCount} beyond turnaround</span>}
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)]">
        {sortedOrders.map((order) => (
          <button key={order.id} type="button" onClick={() => navigate(`/dashboard/lab/${order.id}`)} className={`flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-border)] px-4 py-3 text-left last:border-0 hover:bg-[var(--cp-surface-warm)] ${order.priority === "EMERGENCY" ? "border-l-4 border-l-[var(--cp-critical)] bg-[var(--cp-critical-light)]/30" : order.priority === "URGENT" ? "border-l-4 border-l-[var(--cp-warning)] bg-[var(--cp-warning-light)]/30" : "border-l-4 border-l-transparent"}`}>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--cp-ink)]">{order.testName} <span className="font-normal text-[var(--cp-ink-soft)]">· {order.patientName}</span></p><p className="cp-tabular mt-0.5 text-xs text-[var(--cp-ink-soft)]">{order.orderNumber} · {order.mrNumber} · {order.doctorName || "No referring doctor"}</p></div>
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={order.priority === "EMERGENCY" ? "STAT" : order.priority === "URGENT" ? "Urgent" : "Routine"} tone={order.priority === "EMERGENCY" ? "critical" : order.priority === "URGENT" ? "warning" : undefined} /><StatusBadge status={order.status.replaceAll("_", " ")} />{order.overdue && <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cp-critical)]"><Timer className="h-3.5 w-3.5" />Overdue</span>}</div>
          </button>
        ))}
        {!loading && sortedOrders.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--cp-ink-soft)]">No active Lab orders.</p>}
        {loading && <p className="px-4 py-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading active orders…</p>}
      </div>
    </section>

    <section className="space-y-3">
      <div><h2 className="text-lg font-bold text-[var(--cp-ink)]">Recent activity</h2><p className="text-xs text-[var(--cp-ink-soft)]">Latest Lab order events.</p></div>
      <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
        {overview.recentEvents.map((event) => <div key={event.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--cp-border)] py-2.5 last:border-0"><div><p className="text-sm font-medium text-[var(--cp-ink)]">{eventLabel(event.eventType)} <span className="font-normal text-[var(--cp-ink-soft)]">· {event.testName} for {event.patientName}</span></p><p className="text-xs text-[var(--cp-ink-soft)]">{event.orderNumber} · {event.actorName}</p></div><time className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(event.createdAt)}</time></div>)}
        {!loading && overview.recentEvents.length === 0 && <p className="py-4 text-sm text-[var(--cp-ink-soft)]">No recent Lab activity.</p>}
      </div>
    </section>
    <CreateLabOrderModal open={createOrderOpen} onClose={() => { setCreateOrderOpen(false); void load() }} />
  </div>
}
