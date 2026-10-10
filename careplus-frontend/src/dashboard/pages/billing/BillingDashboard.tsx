import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Receipt, Wallet, AlertCircle, BedDouble, FlaskConical, Pill, Plus } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatCurrency, formatDate, getHospitalDateKey, getHospitalDateKeyForTimestamp } from "@/dashboard/lib/format"
import { BarChartWidget } from "@/dashboard/components/charts/Charts"
import { CreateInvoiceModal } from "@/dashboard/pages/billing/CreateInvoiceModal"

function invoiceTotal(items: { qty: number; unitPrice: number; discount: number }[]) {
  return items.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
}

export default function BillingDashboard() {
  const { invoices, dataLoading } = useDashboard()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [createOpen, setCreateOpen] = React.useState(false)

  const today = getHospitalDateKey()
  const todaysInvoices = invoices.filter((i) => getHospitalDateKeyForTimestamp(i.date) === today)
  const todaysRevenue = todaysInvoices.reduce((s, i) => s + i.payments.reduce((a, p) => a + p.amount, 0), 0)
  const paidCount = invoices.filter((i) => i.status === "Paid").length
  const partialCount = invoices.filter((i) => i.status === "Partial").length
  const unpaidCount = invoices.filter((i) => i.status === "Unpaid").length
  const wardCharges = invoices.flatMap((i) => i.lineItems).filter((li) => li.category === "Ward").reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
  const labRevenue = invoices.flatMap((i) => i.lineItems).filter((li) => li.category === "Lab").reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
  const pharmacyRevenue = invoices.flatMap((i) => i.lineItems).filter((li) => li.category === "Medicine").reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)

  const filtered = invoices.filter((i) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || i.invoiceNumber?.toLowerCase().includes(q) || i.patientName.toLowerCase().includes(q) || i.mrNumber.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)
    const matchesStatus = statusFilter === "all" || i.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Billing" action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Invoice</Button>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Today's Revenue" value={formatCurrency(todaysRevenue)} icon={Wallet} tone="success" />
        <StatCard label="Paid Invoices (All Time)" value={paidCount.toString()} icon={Receipt} tone="success" />
        <StatCard label="Partial Invoices (All Time)" value={partialCount.toString()} icon={AlertCircle} tone="warning" />
        <StatCard label="Unpaid Invoices (All Time)" value={unpaidCount.toString()} icon={AlertCircle} tone="critical" />
        <StatCard label="Ward Charges" value={formatCurrency(wardCharges)} icon={BedDouble} tone="primary" />
        <StatCard label="Lab Revenue" value={formatCurrency(labRevenue)} icon={FlaskConical} tone="primary" />
        <StatCard label="Pharmacy Revenue" value={formatCurrency(pharmacyRevenue)} icon={Pill} tone="primary" />
      </div>

      <Card>
        <CardHeader><CardTitle>Monthly Revenue Report</CardTitle></CardHeader>
        <CardContent>
          <BarChartWidget data={[
            { label: "Feb", value: 620000 }, { label: "Mar", value: 705000 }, { label: "Apr", value: 588000 },
            { label: "May", value: 742000 }, { label: "Jun", value: 810000 }, { label: "Jul", value: 890000 }, { label: "Aug", value: 210000 },
          ]} />
        </CardContent>
      </Card>

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search invoice, patient, or MR number…">
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All statuses" }, { value: "Paid", label: "Paid" }, { value: "Partial", label: "Partial" }, { value: "Unpaid", label: "Unpaid" }, { value: "Void", label: "Void" }]} />
      </FilterBar>

      <DataTable
        rows={filtered}
        getRowKey={(i) => i.id}
        loading={dataLoading}
        emptyIcon={Receipt}
        emptyTitle="No invoices found"
        emptyDescription="Invoices will appear here when they are created."
        onRowClick={(i) => navigate(`/dashboard/billing/${i.id}`)}
        rowTone={(i) => toneFor(i.status)}
        columns={[
          { key: "invoiceNumber", header: "Invoice", render: (i) => <span className="cp-tabular text-xs font-medium">{i.invoiceNumber ?? "Invoice"}</span> },
          { key: "patient", header: "Patient", render: (i) => <div><p className="font-medium">{i.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{i.mrNumber}</p></div> },
          { key: "date", header: "Date", render: (i) => formatDate(i.date), hideOnMobile: true },
          { key: "total", header: "Total", render: (i) => <span className="cp-tabular font-semibold">{formatCurrency(invoiceTotal(i.lineItems))}</span> },
          { key: "paid", header: "Paid", render: (i) => <span className="cp-tabular">{formatCurrency(i.payments.reduce((s, p) => s + p.amount, 0))}</span>, hideOnMobile: true },
          { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
        ]}
      />

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} prefillMR={params.get("mr") ?? undefined} />
    </div>
  )
}
