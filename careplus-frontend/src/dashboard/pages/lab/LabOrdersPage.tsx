import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ClipboardList, TestTubes, Loader2, CheckCircle2, AlertOctagon, Plus, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatDate } from "@/dashboard/lib/format"
import { CreateLabOrderModal } from "@/dashboard/pages/lab/CreateLabOrderModal"

export default function LabOrdersPage() {
  const { labOrders, currentUser } = useDashboard()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState(params.get("mr") ?? "")
  const [status, setStatus] = React.useState(() => {
    const requested = params.get("status")
    if (requested === "PROCESSING") return "Processing"
    if (requested === "ORDERED") return "Ordered"
    return requested ?? "all"
  })
  const [priority, setPriority] = React.useState("all")
  const [createOrderOpen, setCreateOrderOpen] = React.useState(false)

  const filtered = labOrders.filter((l) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || l.orderNumber?.toLowerCase().includes(q) || l.patientName.toLowerCase().includes(q) || l.mrNumber.toLowerCase().includes(q) || l.testName.toLowerCase().includes(q)
    const matchesStatus = status === "all" || l.status === status
    const matchesPriority = priority === "all" || l.priority === priority
    return matchesSearch && matchesStatus && matchesPriority
  })

  const ordered = filtered.filter((l) => l.status === "Ordered").length
  const samplesPending = filtered.filter((l) => l.status !== "Cancelled" && !l.sampleCollectedAt).length
  const processing = filtered.filter((l) => l.status === "Processing").length
  const completed = filtered.filter((l) => l.status === "Completed" || l.status === "Verified").length
  const critical = filtered.filter((l) => l.criticalResult || l.interpretation === "Critical").length

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Laboratory" action={<div className="flex gap-2">
        {["admin", "receptionist", "doctor"].includes(currentUser?.role ?? "") && <Button size="sm" onClick={() => setCreateOrderOpen(true)}><Plus className="h-4 w-4" /> New Lab order</Button>}
        {["admin", "billing_manager", "receptionist"].includes(currentUser?.role ?? "") && <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/lab/invoices")}><Receipt className="h-4 w-4" /> Invoices</Button>}
      </div>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Ordered Tests" value={ordered.toString()} icon={ClipboardList} tone="primary" description="Orders currently in Ordered status." />
        <StatCard label="Samples Pending" value={samplesPending.toString()} icon={TestTubes} tone="warning" description="Active orders whose sample has not been collected." />
        <StatCard label="In Process" value={processing.toString()} icon={Loader2} tone="primary" description="Orders currently being processed." />
        <StatCard label="Completed" value={completed.toString()} icon={CheckCircle2} tone="success" description="Orders with completed or verified results." />
        <StatCard label="Critical Results" value={critical.toString()} icon={AlertOctagon} tone="critical" description="Orders with a critical result interpretation." />
      </div>

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search order, patient, MR number, or test…">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "Ordered", label: "Ordered" }, { value: "Sample Collected", label: "Sample Collected" }, { value: "Processing", label: "Processing" }, { value: "Completed", label: "Completed" }, { value: "Verified", label: "Verified" }]} />
        <FilterSelect label="Priority" value={priority} onChange={setPriority} options={[{ value: "all", label: "All priorities" }, { value: "Routine", label: "Routine" }, { value: "Urgent", label: "Urgent" }, { value: "Emergency", label: "Emergency" }]} />
      </FilterBar>

      <DataTable
        rows={filtered}
        getRowKey={(l) => l.id}
        emptyIcon={ClipboardList}
        emptyTitle="No lab orders found"
        onRowClick={(l) => navigate(`/dashboard/lab/${l.id}`)}
        rowTone={(l) => (l.criticalResult || l.interpretation === "Critical" ? "critical" : toneFor(l.status))}
        columns={[
          { key: "order", header: "Order", render: (l) => <span className="cp-tabular text-xs font-medium">{l.orderNumber ?? "—"}</span> },
          { key: "patient", header: "Patient", render: (l) => <div><p className="font-medium">{l.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{l.mrNumber}</p></div> },
          { key: "doctor", header: "Doctor", render: (l) => l.doctorName, hideOnMobile: true },
          { key: "test", header: "Test", render: (l) => l.testName },
          { key: "date", header: "Order Date", render: (l) => formatDate(l.orderDate), hideOnMobile: true },
          { key: "priority", header: "Priority", render: (l) => <StatusBadge status={l.priority} />, hideOnMobile: true },
          { key: "status", header: "Status", render: (l) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={l.status} />
              {(l.criticalResult || l.interpretation === "Critical") && <StatusBadge status="Critical" tone="critical" />}
            </div>
          ) },
        ]}
      />
      <CreateLabOrderModal open={createOrderOpen} onClose={() => setCreateOrderOpen(false)} />
    </div>
  )
}
