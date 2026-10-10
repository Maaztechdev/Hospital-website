import * as React from "react"
import { Link } from "react-router-dom"
import { FilterX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiPharmacySaleAdjustment } from "@/lib/api"

const PAGE_SIZE = 20

export default function PharmacySaleAdjustmentsPage() {
  const { toast } = useToast()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [type, setType] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [items, setItems] = React.useState<ApiPharmacySaleAdjustment[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listPharmacySaleAdjustments({
        from: from || undefined,
        to: to || undefined,
        type: type ? type as "VOID" | "RETURN" : undefined,
        page,
        limit: PAGE_SIZE,
      })
      setItems(result.items)
      setTotal(result.pagination.total)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to load pharmacy returns and voids"
      setError(message)
      toast({ title: "Unable to load pharmacy activity", description: message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [from, page, to, toast, type])

  React.useEffect(() => { void load() }, [load])

  const updateFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Voided Sales & Returns" />
    <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <div><Label htmlFor="adjustments-from">From</Label><Input id="adjustments-from" type="date" value={from} onChange={(event) => updateFilter(setFrom)(event.target.value)} /></div>
        <div><Label htmlFor="adjustments-to">To</Label><Input id="adjustments-to" type="date" value={to} onChange={(event) => updateFilter(setTo)(event.target.value)} /></div>
        <div><Label htmlFor="adjustments-type">Activity</Label><Select id="adjustments-type" value={type} onChange={(event) => updateFilter(setType)(event.target.value)}><option value="">All activity</option><option value="VOID">Voids</option><option value="RETURN">Returns</option></Select></div>
        <Button variant="outline" onClick={() => { setFrom(""); setTo(""); setType(""); setPage(1) }}><FilterX className="h-4 w-4" /> Clear filters</Button>
      </div>
    </section>
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
    <section className="overflow-hidden rounded-2xl border border-[var(--cp-border)] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-sm">
          <thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">
            <th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Invoice No.</th><th className="px-4 py-3">Staff</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Items</th><th className="px-4 py-3 text-right">Refund value</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">Loading pharmacy activity…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">No voids or returns found for these filters.</td></tr>}
            {!loading && items.map((item) => <tr key={item.id} className="border-b border-[var(--cp-border)] last:border-0">
              <td className="whitespace-nowrap px-4 py-3">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3"><StatusBadge status={item.type === "VOID" ? "VOIDED" : "Returned"} /></td>
              <td className="px-4 py-3 font-medium"><Link className="text-[var(--cp-primary)] underline-offset-2 hover:underline" to={`/dashboard/pharmacy/invoices/${item.invoice.id}`}>{item.invoice.invoiceNumber}</Link></td>
              <td className="px-4 py-3">{item.actor.name}</td>
              <td className="max-w-sm whitespace-normal px-4 py-3">{item.reason}</td>
              <td className="px-4 py-3">{item.items.length ? item.items.map((line) => `${line.saleItem?.medicine.name ?? "Medicine"} × ${line.quantity}${line.returnedToStock ? "" : " (not restocked)"}`).join(", ") : "All sold items"}</td>
              <td className="cp-tabular px-4 py-3 text-right">{Number(item.refundAmount) > 0 ? formatCurrency(Number(item.refundAmount)) : "—"}</td>
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
