import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ClipboardList, TestTubes, Loader2, CheckCircle2, AlertOctagon } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatDate } from "@/dashboard/lib/format"

export default function LabDashboard() {
  const { labOrders } = useDashboard()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState(params.get("mr") ?? "")
  const [status, setStatus] = React.useState("all")
  const [priority, setPriority] = React.useState("all")

  const ordered = labOrders.filter((l) => l.status === "Ordered").length
  const samplesPending = labOrders.filter((l) => l.status === "Sample Collected").length
  const processing = labOrders.filter((l) => l.status === "Processing").length
  const completed = labOrders.filter((l) => l.status === "Completed" || l.status === "Verified").length
  const critical = labOrders.filter((l) => l.interpretation === "Critical").length

  const filtered = labOrders.filter((l) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || l.patientName.toLowerCase().includes(q) || l.mrNumber.toLowerCase().includes(q) || l.testName.toLowerCase().includes(q)
    const matchesStatus = status === "all" || l.status === status
    const matchesPriority = priority === "all" || l.priority === priority
    return matchesSearch && matchesStatus && matchesPriority
  })

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Laboratory" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Ordered Tests" value={ordered.toString()} icon={ClipboardList} tone="primary" />
        <StatCard label="Samples Pending" value={samplesPending.toString()} icon={TestTubes} tone="warning" />
        <StatCard label="In Process" value={processing.toString()} icon={Loader2} tone="primary" />
        <StatCard label="Completed" value={completed.toString()} icon={CheckCircle2} tone="success" />
        <StatCard label="Critical Results" value={critical.toString()} icon={AlertOctagon} tone="critical" />
      </div>

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search patient, MR number, or test…">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "Ordered", label: "Ordered" }, { value: "Sample Collected", label: "Sample Collected" }, { value: "Processing", label: "Processing" }, { value: "Completed", label: "Completed" }, { value: "Verified", label: "Verified" }]} />
        <FilterSelect label="Priority" value={priority} onChange={setPriority} options={[{ value: "all", label: "All priorities" }, { value: "Routine", label: "Routine" }, { value: "Urgent", label: "Urgent" }, { value: "Emergency", label: "Emergency" }]} />
      </FilterBar>

      <DataTable
        rows={filtered}
        getRowKey={(l) => l.id}
        emptyIcon={ClipboardList}
        emptyTitle="No lab orders found"
        onRowClick={(l) => navigate(`/dashboard/lab/${l.id}`)}
        rowTone={(l) => (l.interpretation === "Critical" ? "critical" : toneFor(l.status))}
        columns={[
          { key: "id", header: "Order ID", render: (l) => <span className="cp-tabular text-xs font-medium">{l.id}</span> },
          { key: "patient", header: "Patient", render: (l) => <div><p className="font-medium">{l.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{l.mrNumber}</p></div> },
          { key: "doctor", header: "Doctor", render: (l) => l.doctorName, hideOnMobile: true },
          { key: "test", header: "Test", render: (l) => l.testName },
          { key: "date", header: "Order Date", render: (l) => formatDate(l.orderDate), hideOnMobile: true },
          { key: "priority", header: "Priority", render: (l) => <StatusBadge status={l.priority} />, hideOnMobile: true },
          { key: "status", header: "Status", render: (l) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={l.status} />
              {l.interpretation === "Critical" && <StatusBadge status="Critical" tone="critical" />}
            </div>
          ) },
        ]}
      />
    </div>
  )
}
