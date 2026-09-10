import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { UserPlus, Download, Users, Eye } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { PatientRegisterModal } from "@/dashboard/pages/patients/PatientRegisterModal"

export default function PatientList() {
  const { patients } = useDashboard()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState(params.get("q") ?? "")
  const [gender, setGender] = React.useState("all")
  const [bloodGroup, setBloodGroup] = React.useState("all")
  const [status, setStatus] = React.useState("all")
  const [registerOpen, setRegisterOpen] = React.useState(false)

  const filtered = React.useMemo(() => patients.filter((p) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.phone.includes(q) || p.mrNumber.toLowerCase().includes(q)
    const matchesGender = gender === "all" || p.gender === gender
    const matchesBG = bloodGroup === "all" || p.bloodGroup === bloodGroup
    const matchesStatus = status === "all" || p.status === status
    return matchesSearch && matchesGender && matchesBG && matchesStatus
  }), [patients, search, gender, bloodGroup, status])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Patients"
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => toast({ title: "Export started", description: `${filtered.length} patient records exported.`, variant: "success" })}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              <UserPlus className="h-4 w-4" /> Add Patient
            </Button>
          </>
        }
      />

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search by name, phone, or MR number…" showDensityToggle>
        <FilterSelect label="Gender" value={gender} onChange={setGender} options={[{ value: "all", label: "All genders" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "Other", label: "Other" }]} />
        <FilterSelect label="Blood group" value={bloodGroup} onChange={setBloodGroup} options={[{ value: "all", label: "All blood groups" }, ...["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((b) => ({ value: b, label: b }))]} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} />
      </FilterBar>

      <DataTable
        rows={filtered}
        getRowKey={(p) => p.mrNumber}
        emptyIcon={Users}
        emptyTitle="No patients match your filters"
        emptyDescription="Try adjusting your search or filters, or register a new patient."
        onRowClick={(p) => navigate(`/dashboard/patients/${p.mrNumber}`)}
        columns={[
          { key: "mr", header: "MR Number", render: (p) => <span className="cp-tabular text-xs font-medium">{p.mrNumber}</span>, sortValue: (p) => p.mrNumber },
          { key: "name", header: "Patient Name", render: (p) => <span className="font-medium">{p.name}</span>, sortValue: (p) => p.name },
          { key: "age", header: "Age", render: (p) => p.age, sortValue: (p) => p.age, hideOnMobile: true },
          { key: "gender", header: "Gender", render: (p) => p.gender, hideOnMobile: true },
          { key: "phone", header: "Phone", render: (p) => <span className="cp-tabular">{p.phone}</span> },
          { key: "lastVisit", header: "Last Visit", render: (p) => (p.lastVisit ? formatDate(p.lastVisit) : "—"), hideOnMobile: true },
          { key: "balance", header: "Balance", render: (p) => <span className={p.balance > 0 ? "cp-tabular font-semibold text-[var(--cp-warning)]" : "cp-tabular text-[var(--cp-ink-soft)]"}>{formatCurrency(p.balance)}</span>, sortValue: (p) => p.balance },
          { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
          {
            key: "actions", header: "Actions", render: (p) => (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/patients/${p.mrNumber}`) }}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--cp-border)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]"
              >
                <Eye className="h-3.5 w-3.5" /> View
              </button>
            ),
          },
        ]}
      />

      <PatientRegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  )
}
