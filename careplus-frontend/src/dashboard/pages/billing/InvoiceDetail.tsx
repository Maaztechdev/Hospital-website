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
import { displayPakistaniPhone } from "@/dashboard/lib/format"

export default function InvoiceDetail() {
  const { invoiceId } = useParams()
  const { invoices, patients, dispatch, currentUser } = useDashboard()
  const { toast } = useToast()
  const profile = useHospitalProfile()
  const invoice = invoices.find((i) => i.id === invoiceId)
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [method, setMethod] = React.useState<Payment["method"]>("Cash")
  const [printMode, setPrintMode] = React.useState<"invoice" | "receipt">("invoice")
  const [notes, setNotes] = React.useState("")
  const [paymentSubmitting, setPaymentSubmitting] = React.useState(false)
  const paymentSubmittingRef = React.useRef(false)

  React.useEffect(() => {
    if (!invoiceId) return
    api.getInvoice(invoiceId).then((fresh) => {
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patients.find((patient) => patient.id === fresh.patientId)) })
    }).catch((cause) => toast({ title: "Unable to refresh invoice", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }))
  }, [invoiceId, dispatch, patients, toast])

  if (!invoice) return <NotPermitted />
  const patient = patients.find((p) => p.mrNumber === invoice.mrNumber)
  const total = invoice.grandTotal ?? invoice.lineItems.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
  const paid = invoice.paidAmount ?? invoice.payments.reduce((s, p) => s + p.amount, 0)
  const balance = invoice.balanceAmount ?? total - paid
  const printStatus = invoice.status === "Paid" ? "PAID" : invoice.status === "Partial" ? "PARTIAL" : invoice.status === "Void" ? "VOID" : "UNPAID"
  const subtotal = invoice.lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
  const totalDiscount = invoice.lineItems.reduce((sum, item) => sum + item.discount, 0)
  const amountNumber = Number(amount)
  const amountError = !amount.trim()
    ? "Enter an amount greater than zero."
    : !Number.isFinite(amountNumber) || amountNumber <= 0
      ? "Amount must be greater than zero."
      : amountNumber > balance
        ? `Amount cannot exceed the remaining balance of ${formatCurrency(balance)}.`
        : ""
  const isLabInvoice = invoice.lineItems.some((item) => item.category === "Lab")
  const canVoidInvoice = currentUser?.role === "admin" || (currentUser?.role === "billing_manager" && !isLabInvoice)
  const receiptPayment = invoice.payments.at(-1)

  // Patient-wide ledger
  const patientInvoices = invoices.filter((i) => i.mrNumber === invoice.mrNumber)
  const ledgerBilled = patientInvoices.reduce((s, i) => s + (i.grandTotal ?? i.lineItems.reduce((a, li) => a + li.qty * li.unitPrice - li.discount, 0)), 0)
  const ledgerPaid = patientInvoices.reduce((s, i) => s + (i.paidAmount ?? i.payments.reduce((a, p) => a + p.amount, 0)), 0)

  async function receivePayment() {
    if (paymentSubmittingRef.current) return
    const n = Number(amount)
    if (amountError) return
    paymentSubmittingRef.current = true
    setPaymentSubmitting(true)
    try {
      const updated = await api.recordPayment(invoice!.id, { paymentMethod: method.toUpperCase().replace(" ", "_") as "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET" | "ONLINE", amount: n, notes: notes || undefined })
      const fresh = await api.getInvoice(updated.id)
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patient) })
      toast({ title: "Payment received", description: `${formatCurrency(n)} via ${method}.`, variant: "success" })
      setPaymentOpen(false); setAmount(""); setNotes("")
    } catch (error) {
      toast({ title: "Unable to record payment", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      paymentSubmittingRef.current = false
      setPaymentSubmitting(false)
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

  function print(mode: "invoice" | "receipt") {
    setPrintMode(mode)
    window.setTimeout(() => {
      window.print()
      setPrintMode("invoice")
    }, 50)
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title={`Invoice ${invoice.invoiceNumber ?? ""}`.trim()}
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => print("invoice")}><Printer className="h-4 w-4" /> Print Invoice</Button>
            {invoice.payments.length > 0 && <Button variant="outline" size="sm" onClick={() => print("receipt")}><Printer className="h-4 w-4" /> Print Receipt</Button>}
            {invoice.status !== "Void" && invoice.status !== "Paid" && balance > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setAmount(String(balance)); setPaymentOpen(true) }}><Wallet className="h-4 w-4" /> Receive Payment</Button>
            )}
            {invoice.status !== "Void" && canVoidInvoice && (
              <Button variant="emergency" size="sm" onClick={() => setVoidOpen(true)}><Ban className="h-4 w-4" /> Void Invoice</Button>
            )}
          </>
        }
      />

      <div id="invoice-print-root" className="invoice-print-root" aria-hidden="true">
        <article className="invoice-print-document">
          <header className="invoice-print-header">
            {profile.logoUrl && <img className="invoice-print-logo" src={apiAssetUrl(profile.logoUrl)} alt="" />}
            <div className="invoice-print-hospital">
              <h1>{profile.name}</h1>
              {profile.address && <p>{profile.address}</p>}
              {profile.phone && <p>{profile.phone}</p>}
              {profile.registrationNo && <p>{profile.registrationNo}</p>}
            </div>
            <span className={`invoice-print-status invoice-print-status-${printStatus.toLowerCase()}`}>{printStatus}</span>
          </header>

          <div className="invoice-print-title-row">
            <h2>{printMode === "receipt" ? "Payment Receipt" : "Invoice"}</h2>
            <strong>{invoice.invoiceNumber ?? invoice.id}</strong>
          </div>

          {invoice.status === "Void" && isLabInvoice && <Card><CardContent className="p-4">
            <h2 className="text-sm font-semibold text-[var(--cp-ink)]">Voided Lab invoice — read-only log</h2>
            <p className="mt-1 text-sm text-[var(--cp-ink-soft)]">Reason: {invoice.voidReason || "Not recorded"}</p>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Voided {invoice.voidedAt ? formatDateTime(invoice.voidedAt) : "at an unrecorded time"}{invoice.voidedBy ? ` · ${invoice.voidedBy}` : ""}</p>
          </CardContent></Card>}

          <section className="invoice-print-patient">
            <div><span>Patient</span><strong>{invoice.patientName}</strong></div>
            <div><span>MR Number</span><strong>{invoice.mrNumber}</strong></div>
            <div><span>Phone</span><strong>{patient?.phone ?? "—"}</strong></div>
            <div><span>Date</span><strong>{formatDateTime(invoice.date)}</strong></div>
          </section>
          {printMode === "receipt" && receiptPayment && <section className="invoice-print-patient">
            <div><span>Payment received</span><strong>{formatCurrency(receiptPayment.amount)}</strong></div>
            <div><span>Method</span><strong>{receiptPayment.method}</strong></div>
            <div><span>Received at</span><strong>{formatDateTime(receiptPayment.date)}</strong></div>
            <div><span>Received by</span><strong>{receiptPayment.receivedBy ?? "Billing staff"}</strong></div>
          </section>}

          <table className="invoice-print-items">
            <thead>
              <tr><th>Item</th><th>Category</th><th className="number">Qty</th><th className="number">Unit Price</th><th className="number">Discount</th><th className="number">Amount</th></tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.category === "Medicine" ? "Pharmacy" : item.category}</td>
                  <td className="number">{item.qty}</td>
                  <td className="number">{formatCurrency(item.unitPrice)}</td>
                  <td className="number">{formatCurrency(item.discount)}</td>
                  <td className="number">{formatCurrency(item.qty * item.unitPrice - item.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="invoice-print-totals">
            <div><span>Subtotal</span><strong>{formatCurrency(subtotal)}</strong></div>
            <div><span>Total Discount</span><strong>{formatCurrency(totalDiscount)}</strong></div>
            <div className="grand"><span>Grand Total</span><strong>{formatCurrency(total)}</strong></div>
            <div><span>Paid</span><strong>{formatCurrency(paid)}</strong></div>
            <div className="balance"><span>Balance</span><strong>{formatCurrency(balance)}</strong></div>
          </section>

          <section className="invoice-print-payments">
            <h2>Payment History</h2>
            {invoice.payments.length > 0 ? (
              <table className="invoice-print-items invoice-print-payment-table">
                <thead><tr><th>Date</th><th className="number">Amount</th><th>Method</th><th>Received By</th><th>Notes</th></tr></thead>
                <tbody>{invoice.payments.map((payment) => <tr key={payment.id}><td>{formatDateTime(payment.date)}</td><td className="number">{formatCurrency(payment.amount)}</td><td>{payment.method}</td><td>{payment.receivedBy ?? "—"}</td><td>{payment.notes ?? "—"}</td></tr>)}</tbody>
              </table>
            ) : <p>No payments recorded.</p>}
          </section>

          <footer className="invoice-print-footer">Thank you for choosing {profile.name}.</footer>
        </article>
      </div>

      {invoice.status === "Void" && (
        <div className="rounded-xl border-2 border-[var(--cp-neutral)] bg-[var(--cp-neutral-light)] p-3 text-sm font-medium text-[var(--cp-neutral)]">
          This invoice was voided. Reason: {invoice.voidReason}
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cp-border)] pb-4">
            <div>
              <div className="flex items-center gap-3">{profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="h-10 w-10 object-contain" />}<div><p className="text-lg font-bold text-[var(--cp-ink)]">{profile.name}</p><p className="text-xs text-[var(--cp-ink-soft)]">{[profile.address, profile.phone].filter(Boolean).join(" · ")} · Invoice {invoice.invoiceNumber ?? ""}</p></div></div>
            </div>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Patient</p><p className="font-medium">{invoice.patientName}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">MR Number</p><p className="cp-tabular font-medium">{invoice.mrNumber}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Date</p><p className="font-medium">{formatDateTime(invoice.date)}</p></div>
            <div><p className="text-xs text-[var(--cp-ink-faint)]">Contact</p><p className="cp-tabular font-medium">{displayPakistaniPhone(patient?.phone)}</p></div>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-faint)]">
                  <th className="py-2 pr-4">Date</th><th className="pr-4">Amount</th><th className="pr-4">Method</th><th className="pr-4">Received By</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-[var(--cp-border)] last:border-0">
                    <td className="py-2 pr-4">{formatDateTime(payment.date)}</td>
                    <td className="cp-tabular pr-4 font-semibold">{formatCurrency(payment.amount)}</td>
                    <td className="pr-4">{payment.method}</td>
                    <td className="pr-4">{payment.receivedBy ?? "—"}</td>
                    <td>{payment.notes ?? "—"}</td>
                  </tr>
                ))}
                {invoice.payments.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--cp-ink-soft)]">No payments recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
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
        <p className="mb-3 rounded-lg bg-[var(--cp-bg)] px-3 py-2 text-sm text-[var(--cp-ink-soft)]">
          Current balance: <strong className="cp-tabular text-[var(--cp-ink)]">{formatCurrency(balance)}</strong>
        </p>
        <Label>Amount</Label>
        <Input type="number" min="0" max={balance} step="any" className="cp-tabular" value={amount} aria-invalid={Boolean(amountError)} aria-describedby={amountError ? "payment-amount-error" : undefined} onChange={(e) => setAmount(e.target.value)} />
        {amountError && <p id="payment-amount-error" role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">{amountError}</p>}
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setAmount(String(balance))}>Full balance</Button>
        <Label className="mt-3">Method</Label>
        <Select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
          <option>Cash</option><option>Card</option><option>Bank Transfer</option><option>Mobile Wallet</option><option>Online</option>
        </Select>
        <Label className="mt-3">Notes (optional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={() => setPaymentOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={paymentSubmitting || Boolean(amountError)} onClick={receivePayment}>{paymentSubmitting ? "Recording..." : "Confirm Payment"}</Button>
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
