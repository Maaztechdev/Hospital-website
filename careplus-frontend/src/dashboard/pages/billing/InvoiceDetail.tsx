import * as React from "react"
import { useParams } from "react-router-dom"
import { Printer, Wallet, Ban } from "lucide-react"
import { DashboardPageHeader, NotPermitted } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Payment } from "@/dashboard/types"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { api, toInvoice } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"

export default function InvoiceDetail() {
  const { invoiceId } = useParams()
  const { invoices, patients, dispatch } = useDashboard()
  const { toast } = useToast()
  const profile = useHospitalProfile()
  const invoice = invoices.find((i) => i.id === invoiceId)
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [method, setMethod] = React.useState<Payment["method"]>("Cash")
  const [notes, setNotes] = React.useState("")

  React.useEffect(() => {
    if (!invoiceId) return
    api.getInvoice(invoiceId).then((fresh) => {
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patients.find((patient) => patient.id === fresh.patientId)) })
    }).catch(() => undefined)
  }, [invoiceId, dispatch, patients])

  if (!invoice) return <NotPermitted />
  const patient = patients.find((p) => p.mrNumber === invoice.mrNumber)
  const total = invoice.grandTotal ?? invoice.lineItems.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
  const paid = invoice.paidAmount ?? invoice.payments.reduce((s, p) => s + p.amount, 0)
  const balance = invoice.balanceAmount ?? total - paid

  // Patient-wide ledger
  const patientInvoices = invoices.filter((i) => i.mrNumber === invoice.mrNumber)
  const ledgerBilled = patientInvoices.reduce((s, i) => s + (i.grandTotal ?? i.lineItems.reduce((a, li) => a + li.qty * li.unitPrice - li.discount, 0)), 0)
  const ledgerPaid = patientInvoices.reduce((s, i) => s + (i.paidAmount ?? i.payments.reduce((a, p) => a + p.amount, 0)), 0)

  async function receivePayment() {
    const n = Number(amount)
    if (!n || n <= 0) { toast({ title: "Enter a valid amount", variant: "error" }); return }
    try {
      const updated = await api.recordPayment(invoice!.id, { paymentMethod: method.toUpperCase().replace(" ", "_") as "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET", amount: n, notes: notes || undefined })
      const fresh = await api.getInvoice(updated.id)
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patient) })
      toast({ title: "Payment received", description: `${formatCurrency(n)} via ${method}.`, variant: "success" })
      setPaymentOpen(false); setAmount(""); setNotes("")
    } catch (error) {
      toast({ title: "Unable to record payment", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  async function voidInvoice(reason?: string) {
    if (!reason) return
    try {
      const updated = await api.voidInvoice(invoice!.id, reason)
      const fresh = await api.getInvoice(updated.id)
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patient) })
      toast({ title: "Invoice voided", description: "Marked void with an audit trail entry. Not deleted.", variant: "info" })
      setVoidOpen(false)
    } catch (error) {
      toast({ title: "Unable to void invoice", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title={`Invoice ${invoice.id}`}
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print Invoice</Button>
            {invoice.status !== "Void" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setPaymentOpen(true)}><Wallet className="h-4 w-4" /> Receive Payment</Button>
                <Button variant="emergency" size="sm" onClick={() => setVoidOpen(true)}><Ban className="h-4 w-4" /> Void Invoice</Button>
              </>
            )}
          </>
        }
      />

      {invoice.status === "Void" && (
        <div className="rounded-xl border-2 border-[var(--cp-neutral)] bg-[var(--cp-neutral-light)] p-3 text-sm font-medium text-[var(--cp-neutral)]">
          This invoice was voided. Reason: {invoice.voidReason}
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-border)] pb-4">
            <div>
              <div className="flex items-center gap-3">{profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="h-10 w-10 object-contain" />}<div><p className="text-lg font-bold text-[var(--cp-ink)]">{profile.name}</p><p className="text-xs text-[var(--cp-ink-soft)]">{profile.address ?? ""} · Invoice {invoice.id}</p></div></div>
            </div>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Patient</p><p className="font-medium">{invoice.patientName}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">MR Number</p><p className="cp-tabular font-medium">{invoice.mrNumber}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Date</p><p className="font-medium">{formatDateTime(invoice.date)}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Contact</p><p className="cp-tabular font-medium">{patient?.phone}</p></div>
          </div>

          <table className="mb-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-faint)]">
                <th className="py-2">Item</th><th>Category</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Discount</th><th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-[var(--cp-border)]">
                  <td className="py-2">{li.description}</td>
                  <td>{li.category}</td>
                  <td className="cp-tabular text-right">{li.qty}</td>
                  <td className="cp-tabular text-right">{formatCurrency(li.unitPrice)}</td>
                  <td className="cp-tabular text-right">{formatCurrency(li.discount)}</td>
                  <td className="cp-tabular text-right font-medium">{formatCurrency(li.qty * li.unitPrice - li.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.taxId && <p className="mt-3 text-xs text-[var(--cp-ink-soft)]">Tax ID / NTN: {profile.taxId}</p>}

          <div className="ml-auto flex max-w-xs flex-col gap-1 text-sm">
            <div className="flex justify-between"><span className="text-[var(--cp-ink-soft)]">Grand Total</span><span className="cp-tabular font-bold">{formatCurrency(total)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--cp-ink-soft)]">Paid</span><span className="cp-tabular font-semibold text-[var(--cp-success)]">{formatCurrency(paid)}</span></div>
            <div className="flex justify-between border-t border-[var(--cp-border)] pt-1"><span className="font-semibold text-[var(--cp-ink)]">Balance</span><span className="cp-tabular font-bold text-[var(--cp-warning)]">{formatCurrency(balance)}</span></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        <CardContent>
          {invoice.payments.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No payments recorded yet.</p> : (
            <ul className="flex flex-col gap-2">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3 text-sm">
                  <span className="cp-tabular font-semibold">{formatCurrency(p.amount)}</span>
                  <span>{p.method}</span>
                  <span className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(p.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Patient Ledger — {invoice.patientName}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><p className="text-xs text-[var(--cp-ink-soft)]">Total Billed</p><p className="cp-tabular text-lg font-bold">{formatCurrency(ledgerBilled)}</p></div>
          <div><p className="text-xs text-[var(--cp-ink-soft)]">Total Paid</p><p className="cp-tabular text-lg font-bold text-[var(--cp-success)]">{formatCurrency(ledgerPaid)}</p></div>
          <div><p className="text-xs text-[var(--cp-ink-soft)]">Remaining Balance</p><p className="cp-tabular text-lg font-bold text-[var(--cp-warning)]">{formatCurrency(ledgerBilled - ledgerPaid)}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {invoice.auditTrail.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-[var(--cp-border)] pb-2 last:border-0">
                <span className="font-medium">{a.action}{a.note ? ` — ${a.note}` : ""}</span>
                <span className="text-xs text-[var(--cp-ink-soft)]">{a.by} · {formatDateTime(a.date)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Receive Payment" size="sm">
        <Label>Amount</Label>
        <Input type="number" className="cp-tabular" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Label className="mt-3">Method</Label>
        <Select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
          <option>Cash</option><option>Card</option><option>Bank Transfer</option><option>Mobile Wallet</option>
        </Select>
        <Label className="mt-3">Notes (optional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={() => setPaymentOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={receivePayment}>Confirm Payment</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onConfirm={voidInvoice}
        title="Void this invoice?"
        description="Voided invoices are never deleted — they remain visible with a Void status and an audit trail entry."
        confirmLabel="Void Invoice"
        destructive
        requireReason
        reasonLabel="Reason for voiding"
      />
    </div>
  )
}
