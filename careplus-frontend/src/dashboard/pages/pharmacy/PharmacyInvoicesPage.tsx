import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Eye, FilterX, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { formatCurrency, formatDateTime, formatDate } from "@/dashboard/lib/format"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiPharmacyInvoice, type ApiPharmacySale, type ApiPharmacySettings } from "@/lib/api"
import { InvoicePrintDocument, type PrintLayout } from "./PharmacyPrintDocuments"

const PAGE_SIZE = 20

function invoiceStatus(invoice: ApiPharmacySale["invoice"]) {
  if (invoice.status === "VOID") return "Voided"
  if (Number(invoice.balanceAmount) > 0) return "Credit"
  return "Paid"
}

function saleFromInvoice(invoice: ApiPharmacyInvoice): ApiPharmacySale {
  return {
    id: invoice.pharmacySale.id,
    cashierId: invoice.pharmacySale.cashier.id,
    cashier: invoice.pharmacySale.cashier,
    totalAmount: invoice.grandTotal,
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    taxAmount: invoice.taxAmount,
    paymentMethod: invoice.pharmacySale.paymentMethod,
    customerName: invoice.pharmacySale.customerName,
    customerPhone: invoice.pharmacySale.customerPhone,
    items: invoice.pharmacySale.items,
    invoice,
  }
}

export default function PharmacyInvoicesPage() {
  const navigate = useNavigate()
  const { currentUser } = useDashboard()
  const { toast } = useToast()
  const [search, setSearch] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [items, setItems] = React.useState<ApiPharmacySale[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<ApiPharmacyInvoice | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [voidSubmitting, setVoidSubmitting] = React.useState(false)
  const [printLayout, setPrintLayout] = React.useState<PrintLayout>("a4")
  const [pharmacySettings, setPharmacySettings] = React.useState<ApiPharmacySettings | null>(null)
  const [printing, setPrinting] = React.useState(false)
  const canManageSales = currentUser?.role === "admin" || currentUser?.role === "pharmacist"

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.listPharmacyInvoices({
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: PAGE_SIZE,
      })
      setItems(result.items)
      setTotal(result.pagination.total)
    } catch (error) {
      toast({ title: "Unable to load pharmacy invoices", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [from, page, search, to, toast])

  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => {
    let active = true
    void api.getPharmacySettings().then((result) => {
      if (active) {
        setPharmacySettings(result)
        setPrintLayout(result.defaultReceiptFormat)
      }
    }).catch((error: unknown) => {
      if (active) toast({ title: "Unable to load pharmacy print settings", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    })
    return () => { active = false }
  }, [toast])
  React.useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let active = true
    setDetailLoading(true)
    api.getPharmacyInvoice(selectedId).then((invoice) => {
      if (active) setDetail(invoice)
    }).catch((error) => {
      if (active) {
        toast({ title: "Unable to load invoice details", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
        setSelectedId(null)
      }
    }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId, toast])

  React.useEffect(() => {
    if (!printing) return
    const afterPrint = () => setPrinting(false)
    window.addEventListener("afterprint", afterPrint, { once: true })
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("afterprint", afterPrint)
    }
  }, [printing])

  const changeFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selectedSale = detail ? saleFromInvoice(detail) : null
  const canReturn = Boolean(detail?.status !== "VOID" && detail?.pharmacySale.items.some((item) => {
    const returned = detail.pharmacySale.adjustments
      .filter((adjustment) => adjustment.type === "RETURN")
      .flatMap((adjustment) => adjustment.items)
      .filter((line) => line.saleItemId === item.id)
      .reduce((sum, line) => sum + line.quantity, 0)
    return returned < item.quantity
  }))

  async function voidSelected(reason?: string) {
    if (!detail || !reason || !canManageSales) return
    setVoidSubmitting(true)
    try {
      await api.voidPharmacySale(detail.id, reason)
      const refreshed = await api.getPharmacyInvoice(detail.id)
      setDetail(refreshed)
      await load()
      toast({ title: "Sale voided", description: "The original batches were restored and the invoice remains visible as voided.", variant: "success" })
      setVoidOpen(false)
    } catch (error) {
      toast({ title: "Unable to void sale", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setVoidSubmitting(false)
    }
  }

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Pharmacy Invoices" action={<Button size="sm" onClick={() => navigate("/dashboard/pharmacy/billing")}>New Sale</Button>} />
    <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.5fr)_1fr_1fr_1fr_auto] xl:items-end">
        <div><Label htmlFor="pharmacy-invoice-search">Search invoices</Label><Input id="pharmacy-invoice-search" value={search} placeholder="Invoice no. or customer/patient" onChange={(event) => changeFilter(setSearch)(event.target.value)} /></div>
        <div><Label htmlFor="pharmacy-invoice-from">From</Label><Input id="pharmacy-invoice-from" type="date" value={from} onChange={(event) => changeFilter(setFrom)(event.target.value)} /></div>
        <div><Label htmlFor="pharmacy-invoice-to">To</Label><Input id="pharmacy-invoice-to" type="date" value={to} onChange={(event) => changeFilter(setTo)(event.target.value)} /></div>
        <Button variant="outline" onClick={() => { setSearch(""); setFrom(""); setTo(""); setPage(1) }}><FilterX className="h-4 w-4" /> Clear filters</Button>
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-[var(--cp-border)] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">
            <th className="px-4 py-3">Invoice no.</th><th className="px-4 py-3">Date/time</th><th className="px-4 py-3">Customer / patient</th><th className="px-4 py-3 text-right">Items</th><th className="px-4 py-3">Payment method</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Details</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">Loading pharmacy invoices…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--cp-ink-soft)]">No pharmacy invoices match these filters.</td></tr>}
            {!loading && items.map((sale) => {
              const customer = sale.customerName ?? (sale.invoice.patient ? `${sale.invoice.patient.firstName} ${sale.invoice.patient.lastName}`.trim() : "Walk-in")
              return <tr key={sale.invoice.id} className="border-b border-[var(--cp-border)] last:border-0">
                <td className="px-4 py-3 font-medium">{sale.invoice.invoiceNumber}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(sale.invoice.createdAt)}</td>
                <td className="px-4 py-3">{customer}{sale.invoice.patient?.mrNumber && <span className="ml-1 text-xs text-[var(--cp-ink-soft)]">({sale.invoice.patient.mrNumber})</span>}</td>
                <td className="cp-tabular px-4 py-3 text-right">{sale.items.length}</td>
                <td className="px-4 py-3">{sale.paymentMethod.replaceAll("_", " ")}</td>
                <td className="cp-tabular px-4 py-3 text-right">{formatCurrency(Number(sale.invoice.grandTotal))}</td>
                <td className="px-4 py-3"><StatusBadge status={invoiceStatus(sale.invoice)} /></td>
                <td className="px-4 py-3 text-right"><Button variant="outline" size="sm" onClick={() => setSelectedId(sale.invoice.id)}><Eye className="h-4 w-4" /> View</Button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--cp-border)] px-4 py-3 text-sm">
        <span className="text-[var(--cp-ink-soft)]">{total === 0 ? "0 records" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="flex items-center text-xs text-[var(--cp-ink-soft)]">Page {page} of {pageCount}</span><Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      </div>
    </section>

    <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title={detail ? `Invoice ${detail.invoiceNumber}` : "Invoice details"} size="xl">
      {detailLoading && <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading invoice details…</p>}
      {detail && selectedSale && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-semibold">{detail.patient ? `${detail.patient.firstName} ${detail.patient.lastName}` : detail.pharmacySale.customerName ?? "Walk-in customer"}</p><p className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(detail.createdAt)} · Cashier {detail.pharmacySale.cashier.name}</p><p className="text-xs text-[var(--cp-ink-soft)]">Payment method: {detail.pharmacySale.paymentMethod.replaceAll("_", " ")}</p><p className="text-xs text-[var(--cp-ink-soft)]">Dispensed by {detail.pharmacySale.dispensedBy.map((user) => user.name).join(", ") || detail.pharmacySale.cashier.name}</p></div>
          <StatusBadge status={invoiceStatus(detail)} />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-[var(--cp-bg)] p-3">
          <div><Label htmlFor="pharmacy-print-format">Receipt format</Label><Select id="pharmacy-print-format" value={printLayout} onChange={(event) => setPrintLayout(event.target.value as PrintLayout)}><option value="receipt">80mm thermal</option><option value="a4">A4</option></Select></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Reprint</Button>
            {canManageSales && canReturn && detail.status !== "VOID" && <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/pharmacy/invoices/${detail.id}`)}>Return</Button>}
            {canManageSales && detail.status !== "VOID" && <Button variant="emergency" size="sm" onClick={() => setVoidOpen(true)}>Void</Button>}
          </div>
        </div>
        <div className="max-h-[42vh] overflow-auto rounded-lg border border-[var(--cp-border)]">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b bg-[var(--cp-bg)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="px-3 py-2">Item / batch</th><th className="px-3 py-2">Expiry</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Discount</th><th className="px-3 py-2 text-right">Line total</th></tr></thead>
            <tbody>{detail.pharmacySale.items.map((item) => <tr key={item.id} className="border-b last:border-0">
              <td className="px-3 py-2">{item.medicine.name}<span className="block text-xs text-[var(--cp-ink-soft)]">Batch {item.batch.batchNumber}</span></td>
              <td className="px-3 py-2">{formatDate(item.batch.expiryDate)}</td>
              <td className="cp-tabular px-3 py-2 text-right">{item.quantity}</td>
              <td className="cp-tabular px-3 py-2 text-right">{formatCurrency(Number(item.unitPrice))}</td>
              <td className="cp-tabular px-3 py-2 text-right">{formatCurrency(Number(item.discount))}</td>
              <td className="cp-tabular px-3 py-2 text-right">{formatCurrency(Number(item.subtotal))}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt>Discount</dt><dd className="cp-tabular text-right">{formatCurrency(Number(detail.discountAmount))}</dd>
          <dt>Tax</dt><dd className="cp-tabular text-right">{formatCurrency(Number(detail.taxAmount))}</dd>
          <dt className="border-t pt-1 font-bold">Total</dt><dd className="cp-tabular border-t pt-1 text-right font-bold">{formatCurrency(Number(detail.grandTotal))}</dd>
        </dl>
        {detail.status === "VOID" && <p className="rounded-lg bg-[var(--cp-neutral-light)] p-3 text-sm">VOIDED — {detail.voidReason}</p>}
      </div>}
    </Modal>
    {printing && selectedSale && <InvoicePrintDocument sale={selectedSale} layout={printLayout} pharmacySettings={pharmacySettings} />}
    <ConfirmDialog
      open={voidOpen}
      onClose={() => setVoidOpen(false)}
      onConfirm={(reason) => void voidSelected(reason)}
      title="Void this pharmacy sale?"
      description="Stock will be restored to the original batches and the invoice will remain visible as voided."
      confirmLabel={voidSubmitting ? "Voiding…" : "Void sale"}
      destructive
      requireReason
      reasonLabel="Reason for voiding"
      confirmDisabled={voidSubmitting}
    />
  </div>
}
