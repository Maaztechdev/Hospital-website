import * as React from "react"
import { useNavigate } from "react-router-dom"
import { FlaskConical, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { DataTable } from "@/dashboard/components/DataTable"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { api, toInvoice } from "@/lib/api"
import type { Invoice } from "@/dashboard/types"

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Partial" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Voided" },
]

export default function LabInvoicesPage() {
  const navigate = useNavigate()
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    api.listInvoices({ search: debouncedSearch || undefined, status: status === "all" ? undefined : status, itemType: "LAB" })
      .then((items) => {
        if (active) setInvoices(items.map((invoice) => toInvoice(invoice)))
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to load Lab invoices.")
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [debouncedSearch, status])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Lab invoices" action={<Button size="sm" variant="outline" onClick={() => navigate("/dashboard/lab")}><FlaskConical className="h-4 w-4" /> Lab orders</Button>} />
      {error && <p role="alert" className="rounded-xl border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">{error}</p>}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search invoice number, patient, or MR number…">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={statusOptions} />
      </FilterBar>
      <DataTable
        rows={invoices}
        getRowKey={(invoice) => invoice.id}
        loading={loading}
        emptyIcon={Receipt}
        emptyTitle="No Lab invoices found"
        emptyDescription="Invoices are generated from active Lab test and package prices when an order is created."
        onRowClick={(invoice) => navigate(`/dashboard/billing/${invoice.id}`)}
        columns={[
          { key: "invoice", header: "Invoice", render: (invoice) => <span className="cp-tabular text-xs font-medium">{invoice.invoiceNumber ?? "Invoice"}</span>, sortValue: (invoice) => invoice.invoiceNumber ?? "" },
          { key: "patient", header: "Patient", render: (invoice) => <div><p className="font-medium">{invoice.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{invoice.mrNumber}</p></div>, sortValue: (invoice) => invoice.patientName },
          { key: "date", header: "Date", render: (invoice) => formatDate(invoice.date), hideOnMobile: true },
          { key: "total", header: "Total", render: (invoice) => <span className="cp-tabular font-semibold">{formatCurrency(invoice.grandTotal ?? 0)}</span>, sortValue: (invoice) => invoice.grandTotal ?? 0 },
          { key: "paid", header: "Paid", render: (invoice) => <span className="cp-tabular">{formatCurrency(invoice.paidAmount ?? 0)}</span>, hideOnMobile: true },
          { key: "balance", header: "Balance", render: (invoice) => <span className="cp-tabular">{formatCurrency(invoice.balanceAmount ?? 0)}</span>, hideOnMobile: true },
          { key: "status", header: "Status", render: (invoice) => <StatusBadge status={invoice.status} /> },
        ]}
      />
    </div>
  )
}
