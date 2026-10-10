import * as React from "react"
import { Download, FilterX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiPharmacyDiscountAudit } from "@/lib/api"
import { toCsv } from "@/lib/csv"

const PAGE_SIZE = 20

export default function PharmacyDiscountAuditPage() {
  const { toast } = useToast()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [cashier, setCashier] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [items, setItems] = React.useState<ApiPharmacyDiscountAudit[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalDiscountAmount, setTotalDiscountAmount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [exporting, setExporting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listPharmacyDiscountAudits({ from: from || undefined, to: to || undefined, cashier: cashier.trim() || undefined, page, limit: PAGE_SIZE })
      setItems(result.items)
      setTotal(result.pagination.total)
      setTotalDiscountAmount(result.totalDiscountAmount)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load discount audit"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [cashier, from, page, to])

  React.useEffect(() => { void load() }, [load])

  const filterChanged = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const filters = { from: from || undefined, to: to || undefined, cashier: cashier.trim() || undefined, limit: 100 }
      const first = await api.listPharmacyDiscountAudits({ ...filters, page: 1 })
      const rows: ApiPharmacyDiscountAudit[] = [...first.items]
      const lastPage = Math.ceil(first.pagination.total / first.pagination.limit)
      for (let currentPage = 2; currentPage <= lastPage; currentPage += 1) {
        const next = await api.listPharmacyDiscountAudits({ ...filters, page: currentPage })
        rows.push(...next.items)
      }
      const csvRows: Array<Array<string | number | null>> = [
        ["Timestamp", "Invoice No.", "Cashier", "Approving Admin", "Reason", "Discount %", "Discount Amount (PKR)"],
        ...rows.map((item) => [
          item.createdAt,
          item.invoice.invoiceNumber,
          item.cashier.name,
          item.approvingAdmin?.name ?? "",
          item.reason ?? "",
          Number(item.discountPercent),
          Number(item.discountAmount),
        ]),
      ]
      const blob = new Blob([toCsv(csvRows)], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "pharmacy-discount-audit.csv"
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      toast({ title: "CSV export failed", description: caught instanceof Error ? caught.message : "Unable to export discount audit", variant: "error" })
    } finally {
      setExporting(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Discount Audit" action={<Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || total === 0}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button>} />
    <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_auto] lg:items-end">
        <div><Label htmlFor="discount-from">From</Label><Input id="discount-from" type="date" value={from} onChange={(event) => filterChanged(setFrom)(event.target.value)} /></div>
        <div><Label htmlFor="discount-to">To</Label><Input id="discount-to" type="date" value={to} onChange={(event) => filterChanged(setTo)(event.target.value)} /></div>
        <div><Label htmlFor="discount-cashier">Cashier</Label><Input id="discount-cashier" placeholder="Filter by cashier name" value={cashier} onChange={(event) => filterChanged(setCashier)(event.target.value)} /></div>
        <Button variant="outline" onClick={() => { setFrom(""); setTo(""); setCashier(""); setPage(1) }}><FilterX className="h-4 w-4" /> Clear filters</Button>
      </div>
      <p className="mt-4 text-sm text-[var(--cp-ink-soft)]">Discounts Given: <strong className="cp-tabular text-[var(--cp-ink)]">{formatCurrency(totalDiscountAmount)}</strong></p>
    </section>
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
    <section className="overflow-hidden rounded-2xl border border-[var(--cp-border)] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">
            <th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Invoice No.</th><th className="px-4 py-3">Cashier</th><th className="px-4 py-3">Admin</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3 text-right">Discount %</th><th className="px-4 py-3 text-right">Amount</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">Loading discount audit…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">No discounts found for these filters.</td></tr>}
            {!loading && items.map((item) => <tr key={item.id} className="border-b border-[var(--cp-border)] last:border-0">
              <td className="whitespace-nowrap px-4 py-3">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3 font-medium">{item.invoice.invoiceNumber}</td>
              <td className="px-4 py-3">{item.cashier.name}</td>
              <td className="px-4 py-3">{item.approvingAdmin?.name ?? "—"}</td>
              <td className="max-w-sm whitespace-normal px-4 py-3">{item.reason || "—"}</td>
              <td className="cp-tabular px-4 py-3 text-right">{Number(item.discountPercent).toFixed(2)}%</td>
              <td className="cp-tabular px-4 py-3 text-right">{formatCurrency(Number(item.discountAmount))}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--cp-border)] px-4 py-3 text-sm">
        <span className="text-[var(--cp-ink-soft)]">{total === 0 ? "0 records" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="flex items-center text-xs text-[var(--cp-ink-soft)]">Page {page} of {pageCount}</span><Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      </div>
    </section>
  </div>
}
