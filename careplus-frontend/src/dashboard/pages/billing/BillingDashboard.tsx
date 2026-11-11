import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Download, Plus, Receipt } from "lucide-react"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { CreateInvoiceModal } from "@/dashboard/pages/billing/CreateInvoiceModal"
import { api, toInvoice, type ApiError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import type { ApiBillingStaff, ApiBillingSummary, ApiInvoiceDepartment } from "@/lib/api"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { toCsv } from "@/lib/csv"

function invoiceTotal(items: { qty: number; unitPrice: number; discount: number }[]) {
  return items.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
}

export default function BillingDashboard() {
  const { toast } = useToast()
  const { currentUser } = useDashboard()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [departmentFilter, setDepartmentFilter] = React.useState(() => params.get("department") ?? "all")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [createdBy, setCreatedBy] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [billingSummary, setBillingSummary] = React.useState<ApiBillingSummary | null>(null)
  const [summaryError, setSummaryError] = React.useState("")
  const [staff, setStaff] = React.useState<ApiBillingStaff[]>([])
  const [staffError, setStaffError] = React.useState("")
  const [exporting, setExporting] = React.useState(false)
  const [summaryReload, setSummaryReload] = React.useState(0)
  const [invoicePage, setInvoicePage] = React.useState<Awaited<ReturnType<typeof api.listInvoicesPage>> | null>(null)
  const [invoiceLoading, setInvoiceLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const pageSize = 20
  const filtered = React.useMemo(() => invoicePage?.data.map((invoice) => toInvoice(invoice)) ?? [], [invoicePage])
  const totalInvoices = invoicePage?.pagination.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalInvoices / pageSize))
  const isReceptionist = currentUser?.role === "receptionist"
  const isAllBilling = currentUser?.role === "admin" || currentUser?.role === "billing_manager"
  const availableDepartments: ApiInvoiceDepartment[] = currentUser?.role === "admin" || currentUser?.role === "billing_manager"
    ? ["RECEPTION", "LAB", "PHARMACY", "ULTRASOUND", "IPD"]
    : currentUser?.role === "receptionist"
      ? ["RECEPTION"]
      : currentUser?.role === "lab_technician"
        ? ["LAB"]
        : currentUser?.role === "pharmacist"
          ? ["PHARMACY"]
          : currentUser?.role === "ultrasound_tech" || currentUser?.role === "ultrasound_technician"
            ? ["ULTRASOUND"]
            : []

  React.useEffect(() => {
    let cancelled = false
    setInvoiceLoading(true)
    api.listInvoicesPage({
      search: search.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      department: isReceptionist ? "RECEPTION" : departmentFilter === "all" ? undefined : departmentFilter as ApiInvoiceDepartment,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      createdBy: createdBy || undefined,
      page,
      pageSize,
    })
      .then((result) => { if (!cancelled) setInvoicePage(result) })
      .catch((error: ApiError) => {
        if (!cancelled) toast({ title: "Unable to load invoices", description: error.message, variant: "error" })
      })
      .finally(() => { if (!cancelled) setInvoiceLoading(false) })
    return () => { cancelled = true }
  }, [page, pageSize, search, statusFilter, departmentFilter, dateFrom, dateTo, createdBy, toast, isReceptionist])

  React.useEffect(() => {
    if (!isAllBilling) return
    let cancelled = false
    setSummaryError("")
    api.getBillingSummary(dateFrom || undefined, dateTo || undefined)
      .then((summary) => { if (!cancelled) setBillingSummary(summary) })
      .catch((error: ApiError) => {
        if (!cancelled) {
          setSummaryError(error.message)
          toast({ title: "Unable to load billing totals", description: error.message, variant: "error" })
        }
      })
    return () => { cancelled = true }
  }, [dateFrom, dateTo, summaryReload, toast, isAllBilling])

  React.useEffect(() => {
    if (!isAllBilling) return
    let active = true
    setStaffError("")
    api.listBillingStaff(departmentFilter === "all" ? undefined : departmentFilter as ApiInvoiceDepartment)
      .then((result) => { if (active) setStaff(result) })
      .catch((error: ApiError) => {
        if (!active) return
        setStaffError(error.message)
        toast({ title: "Unable to load billing staff", description: error.message, variant: "error" })
      })
    return () => { active = false }
  }, [departmentFilter, isAllBilling, toast])

  const exportFilteredInvoices = async () => {
    setExporting(true)
    try {
      const filters = {
        search: search.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        department: isReceptionist ? "RECEPTION" as ApiInvoiceDepartment : departmentFilter === "all" ? undefined : departmentFilter as ApiInvoiceDepartment,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        createdBy: createdBy || undefined,
        page: 1,
        pageSize: 100,
      }
      const firstPage = await api.listInvoicesPage(filters)
      const allRows = [...firstPage.data]
      const pageCount = Math.ceil(firstPage.pagination.total / filters.pageSize)
      for (let exportPage = 2; exportPage <= pageCount; exportPage += 1) {
        const result = await api.listInvoicesPage({ ...filters, page: exportPage })
        allRows.push(...result.data)
      }
      const csvRows = [
        ["Invoice", "Department", "Patient", "MR number", "Date", "Status", "Total", "Paid", "Outstanding"],
        ...allRows.map((invoice) => [
          invoice.invoiceNumber,
          invoice.department ?? "RECEPTION",
          invoice.patient ? `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim() : "",
          invoice.patient?.mrNumber ?? "",
          invoice.createdAt,
          invoice.status,
          invoice.grandTotal,
          invoice.paidAmount,
          invoice.balanceAmount,
        ]),
      ]
      const url = URL.createObjectURL(new Blob(["\uFEFF", toCsv(csvRows)], { type: "text/csv;charset=utf-8" }))
      const link = document.createElement("a")
      link.href = url
      link.download = "all-billing-filtered.csv"
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: "CSV export failed", description: error instanceof Error ? error.message : "Unable to export filtered billing rows.", variant: "error" })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title={isAllBilling ? "All billing" : "Billing"} action={<>
        {isAllBilling && <Button size="sm" variant="outline" onClick={() => void exportFilteredInvoices()} disabled={exporting || totalInvoices === 0}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button>}
        {isReceptionist && <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/billing/collect")}><Receipt className="h-4 w-4" /> Collect payments</Button>}
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Invoice</Button>
      </>} />

      {isAllBilling && (
        <section aria-label="Department totals" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--cp-ink)]">Department totals</h2>
            {summaryError && <Button size="sm" variant="outline" onClick={() => setSummaryReload((value) => value + 1)}>Retry totals</Button>}
          </div>
          {summaryError && <p role="alert" className="text-sm text-[var(--cp-critical)]">{summaryError}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {billingSummary?.departments.map((department) => {
              const label = department.department === "RECEPTION" ? "Reception" : department.department[0] + department.department.slice(1).toLowerCase()
              const ipdAmount = billingSummary.billedViaIpd.find((item) => item.sourceDepartment === department.department)?.amount ?? 0
              return (
                <div key={department.department} data-testid={`billing-total-${department.department}`} className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3">
                  <h3 className="text-sm font-semibold text-[var(--cp-ink)]">{label}</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-[var(--cp-ink-soft)]">Invoiced</dt><dd className="text-right cp-tabular">{formatCurrency(Number(department.invoiced))}</dd>
                    <dt className="text-[var(--cp-ink-soft)]">Collected</dt><dd className="text-right cp-tabular">{formatCurrency(Number(department.collected))}</dd>
                    <dt className="text-[var(--cp-ink-soft)]">Refunded</dt><dd className="text-right cp-tabular">{formatCurrency(Number(department.refunded))}</dd>
                    <dt className="text-[var(--cp-ink-soft)]">Outstanding</dt><dd className="text-right cp-tabular">{formatCurrency(Number(department.outstanding))}</dd>
                    <dt className="text-[var(--cp-ink-soft)]">Billed via IPD</dt><dd className="text-right cp-tabular">{formatCurrency(Number(ipdAmount))}</dd>
                  </dl>
                </div>
              )
            })}
            {!billingSummary && !summaryError && <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading department totals…</p>}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3">
        <FilterBar search={search} onSearchChange={(value) => { setSearch(value); setPage(1) }} searchPlaceholder="Search invoice, patient, or MR number…">
          <FilterSelect label="Status" value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1) }} options={[{ value: "all", label: "All statuses" }, { value: "PAID", label: "Paid" }, { value: "PARTIAL", label: "Partial" }, { value: "UNPAID", label: "Unpaid" }, { value: "OUTSTANDING", label: "Unpaid or partial" }, { value: "REFUNDED", label: "Refunded" }, { value: "PARTIALLY_REFUNDED", label: "Partially refunded" }, { value: "VOID", label: "Void" }]} />
          {!isReceptionist && <FilterSelect label="Department" value={departmentFilter} onChange={(value) => { setDepartmentFilter(value); setCreatedBy(""); setPage(1) }} options={[
            { value: "all", label: "All departments" },
            ...availableDepartments.map((department) => ({
              value: department,
              label: department === "RECEPTION" ? "Reception" : department === "IPD" ? "IPD" : department[0] + department.slice(1).toLowerCase(),
            })),
          ]} />}
          {isAllBilling && <FilterSelect label="Staff" value={createdBy} onChange={(value) => { setCreatedBy(value); setPage(1) }} options={[{ value: "", label: "All staff" }, ...staff.map((user) => ({ value: user.id, label: user.name }))]} />}
        </FilterBar>
        {staffError && <p role="alert" className="text-sm text-[var(--cp-critical)]">Staff filter unavailable: {staffError}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
            Date from
            <input aria-label="Date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} className="h-9 rounded-md border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-ink)]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
            Date to
            <input aria-label="Date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} className="h-9 rounded-md border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-ink)]" />
          </label>
        </div>
      </div>

      <DataTable
        rows={filtered}
        pageSize={pageSize}
        getRowKey={(i) => i.id}
        loading={invoiceLoading}
        emptyIcon={Receipt}
        emptyTitle="No invoices found"
        emptyDescription="Invoices will appear here when they are created."
        onRowClick={(i) => navigate(`/dashboard/billing/${i.id}`)}
        rowTone={(i) => toneFor(i.status)}
        columns={[
          { key: "invoiceNumber", header: "Invoice", render: (i) => <span className="cp-tabular text-xs font-medium">{i.invoiceNumber ?? "Invoice"}</span> },
          { key: "department", header: "Department", render: (i) => i.department ?? "Reception" },
          { key: "patient", header: "Patient", render: (i) => <div><p className="font-medium">{i.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{i.mrNumber}</p></div> },
          { key: "date", header: "Date", render: (i) => formatDate(i.date), hideOnMobile: true },
          { key: "total", header: "Total", render: (i) => <span className="cp-tabular font-semibold">{formatCurrency(invoiceTotal(i.lineItems))}</span> },
          { key: "paid", header: "Net collected", render: (i) => <span className="cp-tabular">{formatCurrency(i.payments.reduce((s, p) => s + (p.type === "REFUND" ? -p.amount : p.amount), 0))}</span>, hideOnMobile: true },
          { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
        ]}
      />
      {totalInvoices > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[var(--cp-ink-soft)]">Page {page} of {totalPages} · {totalInvoices} records</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || invoiceLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || invoiceLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
          </div>
        </div>
      )}

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} prefillMR={params.get("mr") ?? undefined} appointmentId={params.get("appointmentId") ?? undefined} />
    </div>
  )
}
