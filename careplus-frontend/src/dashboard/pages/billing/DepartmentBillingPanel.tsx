import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { CreateInvoiceModal } from "@/dashboard/pages/billing/CreateInvoiceModal"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { api, toInvoice, type ApiBillingStaff, type ApiInvoice, type ApiInvoiceDepartment } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

const PAGE_SIZE = 20

interface InvoiceTableProps {
  invoices: ApiInvoice[]
  onOpen: (id: string) => void
}

export function InvoiceTable({ invoices, onOpen }: InvoiceTableProps) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--cp-border-strong)] px-4 py-10 text-center">
        <Receipt className="mx-auto mb-2 h-5 w-5 text-[var(--cp-ink-faint)]" />
        <p className="text-sm font-medium text-[var(--cp-ink)]">No invoices found</p>
        <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Invoices matching these filters will appear here.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {invoices.map((invoice) => {
        const patientName = invoice.patient
          ? `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim()
          : "Patient"
        const paid = Number(invoice.paidAmount)
        const balance = Number(invoice.balanceAmount)
        return (
          <button
            type="button"
            key={invoice.id}
            onClick={() => onOpen(invoice.id)}
            className="grid w-full gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 text-left transition hover:border-[var(--cp-primary)] hover:bg-[var(--cp-surface-warm)] sm:grid-cols-[minmax(0,1.5fr)_minmax(8rem,1fr)_auto] sm:items-center sm:p-4"
            aria-label={`Open invoice ${invoice.invoiceNumber}`}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--cp-ink)]">{patientName}</p>
              <p className="mt-0.5 break-all text-xs text-[var(--cp-ink-soft)]">{invoice.invoiceNumber} · {invoice.patient?.mrNumber ?? "No MR number"}</p>
              <p className="mt-0.5 text-xs text-[var(--cp-ink-faint)]">{formatDate(invoice.createdAt)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:block sm:text-right">
              <span className="text-[var(--cp-ink-soft)]">Total <strong className="cp-tabular text-[var(--cp-ink)]">{formatCurrency(Number(invoice.grandTotal))}</strong></span>
              <span className="text-[var(--cp-ink-soft)]">Paid <strong className="cp-tabular text-[var(--cp-ink)]">{formatCurrency(paid)}</strong></span>
              <span className="text-[var(--cp-ink-soft)]">Due <strong className="cp-tabular text-[var(--cp-ink)]">{formatCurrency(balance)}</strong></span>
            </div>
            <span className="justify-self-start sm:justify-self-end"><StatusBadge status={toInvoice(invoice).status} /></span>
          </button>
        )
      })}
    </div>
  )
}

export default function DepartmentBillingPanel({
  department,
  departments,
  title,
  collectOnly = false,
}: {
  department?: ApiInvoiceDepartment
  departments?: ApiInvoiceDepartment[]
  title: string
  collectOnly?: boolean
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const scopedDepartments = React.useMemo(
    () => departments ?? (department ? [department] : []),
    [department, departments],
  )
  const [selectedDepartment, setSelectedDepartment] = React.useState<ApiInvoiceDepartment | "all">(department ?? "all")
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [createdBy, setCreatedBy] = React.useState("")
  const [staff, setStaff] = React.useState<ApiBillingStaff[]>([])
  const [invoices, setInvoices] = React.useState<ApiInvoice[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pendingOnly, setPendingOnly] = React.useState(collectOnly)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [staffError, setStaffError] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [reloadVersion, setReloadVersion] = React.useState(0)

  const selectedDepartments = React.useMemo(
    () => selectedDepartment === "all" ? scopedDepartments : [selectedDepartment],
    [scopedDepartments, selectedDepartment],
  )
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  React.useEffect(() => {
    let active = true
    setStaffError("")
    api.listBillingStaff(selectedDepartment === "all" ? undefined : selectedDepartment)
      .then((result) => { if (active) setStaff(result) })
      .catch((cause: unknown) => {
        if (active) {
          const message = cause instanceof Error ? cause.message : "Unable to load billing staff."
          setStaffError(message)
          toast({ title: "Unable to load billing staff", description: message, variant: "error" })
        }
      })
    return () => { active = false }
  }, [selectedDepartment, toast])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    api.listInvoicesPage({
      search: search.trim() || undefined,
      status: pendingOnly ? "OUTSTANDING" : status === "all" ? undefined : status,
      ...(selectedDepartment === "all" && selectedDepartments.length > 1
        ? { departments: selectedDepartments }
        : selectedDepartment === "all"
          ? {}
          : { department: selectedDepartment }),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      createdBy: createdBy || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return
        setInvoices(result.data)
        setTotal(result.pagination.total)
      })
      .catch((cause: unknown) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : "Unable to load invoices."
        setError(message)
        setInvoices([])
        setTotal(0)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [createdBy, dateFrom, dateTo, page, pendingOnly, reloadVersion, search, selectedDepartment, selectedDepartments, status])

  const resetPage = () => setPage(1)
  const onDepartmentChange = (value: string) => {
    setSelectedDepartment(value === "all" ? "all" : value as ApiInvoiceDepartment)
    setCreatedBy("")
    resetPage()
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title={title}
        action={!collectOnly && department ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Manual Invoice</Button>
        ) : undefined}
      />

      {!collectOnly && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing views">
          <Button type="button" size="sm" variant={!pendingOnly ? "primary" : "outline"} role="tab" aria-selected={!pendingOnly} onClick={() => { setPendingOnly(false); resetPage() }}>Invoice history</Button>
          <Button type="button" size="sm" variant={pendingOnly ? "primary" : "outline"} role="tab" aria-selected={pendingOnly} onClick={() => { setPendingOnly(true); resetPage() }}>Pending payments</Button>
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={(value) => { setSearch(value); resetPage() }}
        searchPlaceholder="Search patient, MR number, or invoice…"
      >
        {scopedDepartments.length > 1 && (
          <FilterSelect
            label="Department"
            value={selectedDepartment}
            onChange={onDepartmentChange}
            options={[
              { value: "all", label: "All departments" },
              ...scopedDepartments.map((value) => ({ value, label: value[0] + value.slice(1).toLowerCase() })),
            ]}
          />
        )}
        {!collectOnly && (
          <FilterSelect
            label="Status"
            value={pendingOnly ? "OUTSTANDING" : status}
            onChange={(value) => { setStatus(value); setPendingOnly(value === "OUTSTANDING"); resetPage() }}
            options={[
              { value: "all", label: "All statuses" },
              { value: "OUTSTANDING", label: "Unpaid or partial" },
              { value: "UNPAID", label: "Unpaid" },
              { value: "PARTIAL", label: "Partial" },
              { value: "PAID", label: "Paid" },
              { value: "REFUNDED", label: "Refunded" },
              { value: "PARTIALLY_REFUNDED", label: "Partially refunded" },
              { value: "VOID", label: "Voided" },
            ]}
          />
        )}
        <FilterSelect
          label="Staff"
          value={createdBy}
          onChange={(value) => { setCreatedBy(value); resetPage() }}
          options={[{ value: "", label: "All staff" }, ...staff.map((user) => ({ value: user.id, label: user.name }))]}
        />
      </FilterBar>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
          Date from
          <input aria-label="Date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); resetPage() }} className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-sm text-[var(--cp-ink)]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
          Date to
          <input aria-label="Date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); resetPage() }} className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-sm text-[var(--cp-ink)]" />
        </label>
      </div>

      {staffError && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">Staff filter unavailable: {staffError}</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setReloadVersion((value) => value + 1)}>Retry</Button>
        </div>
      )}

      {loading && <p role="status" className="py-3 text-center text-sm text-[var(--cp-ink-soft)]">Loading invoices…</p>}
      {!loading && !error && <InvoiceTable invoices={invoices} onOpen={(id) => navigate(`/dashboard/billing/${id}`)} />}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-xs text-[var(--cp-ink-soft)]">Page {page} of {totalPages} · {total} invoices</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
          </div>
        </div>
      )}

      {department && (
        <CreateInvoiceModal
          open={createOpen}
          onClose={() => { setCreateOpen(false); setReloadVersion((value) => value + 1) }}
          department={department}
        />
      )}
    </div>
  )
}
