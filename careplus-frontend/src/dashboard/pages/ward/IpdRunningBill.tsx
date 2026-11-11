import * as React from "react"
import { Printer, RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Modal } from "@/dashboard/components/Primitives"
import { formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { useToast } from "@/hooks/use-toast"
import { api, openAuthenticatedPrintWindow, type ApiIpdRunningBill, type ApiIpdServiceCharge, type ApiPayment } from "@/lib/api"

const PAYMENT_ROLES = ["admin", "billing_manager", "receptionist"]
const REVERSAL_ROLES = ["admin", "billing_manager"]
const SERVICE_ROLES = ["admin", "billing_manager", "receptionist", "doctor", "nurse"]
const PAYMENT_METHODS: ApiPayment["paymentMethod"][] = ["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "ONLINE"]

function amount(value: number | string | null | undefined) {
  return Number(value ?? 0)
}

function itemTotal(item: ApiIpdRunningBill["invoice"]["items"][number]) {
  return amount(item.subtotal ?? amount(item.unitPrice) * item.quantity - amount(item.discount))
}

function BillCategory({ title, items }: { title: string; items: ApiIpdRunningBill["invoice"]["items"] }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">{title}</h4>
      {items.length === 0 ? (
        <p className="rounded-lg bg-[var(--cp-bg)] px-3 py-2 text-xs text-[var(--cp-ink-soft)]">No {title.toLowerCase()} charges.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="break-words text-sm font-medium text-[var(--cp-ink)]">{item.description}</p>
                  {item.itemType === "OT" && (
                    <span className="inline-flex rounded-full bg-[var(--cp-primary-light)] px-2 py-0.5 text-[10px] font-bold text-[var(--cp-primary)]">
                      OT
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">
                  {item.serviceDate ? formatDate(item.serviceDate) : formatDate(item.createdAt ?? "")}
                  {item.quantity > 1 ? ` · Qty ${item.quantity}` : ""}
                  {item.dayIndex ? ` · Day ${item.dayIndex}` : ""}
                </p>
                {item.reversalReason && <p className="mt-1 text-xs text-[var(--cp-warning)]">Reason: {item.reversalReason}</p>}
                {item.reversedAt && <span className="mt-1 inline-flex rounded-full bg-[var(--cp-warning-light)] px-2 py-0.5 text-[10px] font-semibold text-[var(--cp-warning)]">Reversed</span>}
              </div>
              <span className="cp-tabular shrink-0 text-sm font-semibold text-[var(--cp-ink)]">{formatCurrency(itemTotal(item))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function IpdRunningBill({ admissionId, final = false }: { admissionId: string; final?: boolean }) {
  const { currentUser } = useDashboard()
  const { toast } = useToast()
  const role = (currentUser?.role ?? "").toLowerCase()
  const canView = ["admin", "billing_manager", "receptionist", "doctor", "nurse"].includes(role)
  const canAddService = SERVICE_ROLES.includes(role)
  const canCollect = PAYMENT_ROLES.includes(role)
  const canReverse = REVERSAL_ROLES.includes(role)
  const [bill, setBill] = React.useState<ApiIpdRunningBill | null>(null)
  const [serviceCharges, setServiceCharges] = React.useState<ApiIpdServiceCharge[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [serviceChargeId, setServiceChargeId] = React.useState("")
  const [serviceQuantity, setServiceQuantity] = React.useState("1")
  const [paymentAmount, setPaymentAmount] = React.useState("")
  const [paymentPurpose, setPaymentPurpose] = React.useState<"DEPOSIT" | "PAYMENT">("PAYMENT")
  const [paymentMethod, setPaymentMethod] = React.useState<ApiPayment["paymentMethod"]>("CASH")
  const [paymentNotes, setPaymentNotes] = React.useState("")
  const [reasonTarget, setReasonTarget] = React.useState<{ kind: "refund" } | { kind: "reverse"; itemId: string } | null>(null)
  const [reason, setReason] = React.useState("")
  const [refundAmount, setRefundAmount] = React.useState("")

  const load = React.useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const [runningBill, charges] = await Promise.all([
        api.getIpdRunningBill(admissionId),
        canAddService ? api.listIpdServiceCharges() : Promise.resolve([]),
      ])
      setBill(runningBill)
      setServiceCharges(charges)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to load the IPD running bill."
      setError(message)
      toast({ title: "Unable to load IPD bill", description: message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [admissionId, canAddService, canView, toast])

  React.useEffect(() => { void load() }, [load])

  async function saveServiceLine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quantity = Number(serviceQuantity)
    if (!serviceChargeId || !Number.isInteger(quantity) || quantity < 1) return
    setBusy(true)
    try {
      await api.addIpdServiceLine(admissionId, { serviceChargeId, quantity })
      toast({ title: "Service charge added", variant: "success" })
      setServiceChargeId("")
      setServiceQuantity("1")
      await load()
    } catch (cause) {
      toast({ title: "Unable to add service charge", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function savePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(paymentAmount)
    if (!Number.isFinite(value) || value <= 0) return
    setBusy(true)
    try {
      await api.recordIpdPayment(admissionId, {
        amount: value,
        paymentMethod,
        purpose: paymentPurpose,
        ...(paymentNotes.trim() ? { notes: paymentNotes.trim() } : {}),
      })
      toast({ title: paymentPurpose === "DEPOSIT" ? "Deposit recorded" : "Payment recorded", variant: "success" })
      setPaymentAmount("")
      setPaymentNotes("")
      await load()
    } catch (cause) {
      toast({ title: "Unable to record payment", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function submitReason(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedReason = reason.trim()
    if (!normalizedReason || !bill) return
    setBusy(true)
    try {
      if (reasonTarget?.kind === "refund") {
        const value = Number(refundAmount)
        if (!Number.isFinite(value) || value <= 0) return
        await api.refundIpdPayment(admissionId, { amount: value, paymentMethod, reason: normalizedReason })
        toast({ title: "Refund recorded", variant: "success" })
      } else if (reasonTarget?.kind === "reverse") {
        await api.reverseIpdInvoiceItem(admissionId, reasonTarget.itemId, normalizedReason)
        toast({ title: "Bill line reversed", variant: "success" })
      }
      setReasonTarget(null)
      setReason("")
      setRefundAmount("")
      await load()
    } catch (cause) {
      toast({ title: "Unable to apply bill adjustment", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  if (!canView) {
    return <p className="rounded-lg border border-[var(--cp-border)] p-3 text-sm text-[var(--cp-ink-soft)]">IPD billing details are not available for your role.</p>
  }
  if (loading && !bill) {
    return <div role="status" className="animate-pulse rounded-xl border border-[var(--cp-border)] p-5 text-sm text-[var(--cp-ink-soft)]">Loading running bill…</div>
  }
  if (!bill && error) {
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--cp-critical)] p-4" role="alert"><span className="text-sm text-[var(--cp-critical)]">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Retry</Button></div>
  }
  if (!bill) return <p className="rounded-lg border border-[var(--cp-border)] p-3 text-sm text-[var(--cp-ink-soft)]">No IPD invoice is linked to this admission.</p>

  const invoice = bill.invoice
  const depositTotal = invoice.payments.reduce((sum, payment) => {
    if (payment.purpose !== "DEPOSIT") return sum
    return sum + (payment.type === "REFUND" ? -amount(payment.amount) : amount(payment.amount))
  }, 0)
  const chargeBalance = amount(bill.totals.charged) - amount(bill.totals.paid)
  const categories = [
    { title: "Bed", items: bill.categories.bed },
    { title: "Medicines", items: bill.categories.medicines },
    { title: "Services", items: bill.categories.services },
    { title: "Tests", items: bill.categories.tests },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{final ? "Final IPD bill" : "IPD running bill"}</CardTitle>
          <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{invoice.invoiceNumber} · {invoice.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          <Button size="sm" variant="outline" onClick={() => openAuthenticatedPrintWindow(`/print/ipd-bill/${admissionId}${final ? "?final=true" : ""}`)}><Printer className="h-4 w-4" /> Print {final ? "Final" : "Running"} Bill</Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">{error}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-[var(--cp-bg)] p-3"><p className="text-xs text-[var(--cp-ink-soft)]">Charged</p><p className="mt-1 font-semibold">{formatCurrency(amount(bill.totals.charged))}</p></div>
          <div className="rounded-lg bg-[var(--cp-bg)] p-3"><p className="text-xs text-[var(--cp-ink-soft)]">Paid (net)</p><p className="mt-1 font-semibold">{formatCurrency(amount(bill.totals.paid))}</p></div>
          <div className="rounded-lg bg-[var(--cp-bg)] p-3"><p className="text-xs text-[var(--cp-ink-soft)]">Balance</p><p className="mt-1 font-semibold">{formatCurrency(amount(bill.totals.balance))}</p></div>
          <div className="rounded-lg bg-[var(--cp-bg)] p-3"><p className="text-xs text-[var(--cp-ink-soft)]">Deposit paid (net)</p><p className="mt-1 font-semibold">{formatCurrency(depositTotal)}</p></div>
        </div>

        {canAddService && invoice.status !== "FINALIZED" && invoice.status !== "VOID" && (
          <form onSubmit={(event) => void saveServiceLine(event)} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-[var(--cp-border)] p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <div className="min-w-0">
              <Label htmlFor={`ipd-service-${admissionId}`}>Add service line</Label>
              <Select id={`ipd-service-${admissionId}`} value={serviceChargeId} onChange={(event) => setServiceChargeId(event.target.value)} required>
                <option value="">Select service</option>
                {serviceCharges.map((charge) => <option key={charge.id} value={charge.id}>{charge.name} · {formatCurrency(amount(charge.defaultPrice))}</option>)}
              </Select>
            </div>
            <div><Label htmlFor={`ipd-service-qty-${admissionId}`}>Quantity</Label><Input id={`ipd-service-qty-${admissionId}`} type="number" min="1" step="1" value={serviceQuantity} onChange={(event) => setServiceQuantity(event.target.value)} /></div>
            <Button type="submit" size="sm" disabled={busy || serviceCharges.length === 0}>{busy ? "Saving…" : "Add service"}</Button>
          </form>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {categories.map((category) => <BillCategory key={category.title} title={category.title} items={category.items} />)}
        </div>

        {canCollect && invoice.status !== "VOID" && (
          <form onSubmit={(event) => void savePayment(event)} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-[var(--cp-border)] p-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label htmlFor={`ipd-payment-purpose-${admissionId}`}>Transaction</Label><Select id={`ipd-payment-purpose-${admissionId}`} value={paymentPurpose} onChange={(event) => setPaymentPurpose(event.target.value as "DEPOSIT" | "PAYMENT")}><option value="DEPOSIT">Deposit</option><option value="PAYMENT">Payment</option></Select></div>
            <div><Label htmlFor={`ipd-payment-amount-${admissionId}`}>Amount (PKR)</Label><Input id={`ipd-payment-amount-${admissionId}`} aria-label="Amount (PKR)" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></div>
            <div><Label htmlFor={`ipd-payment-method-${admissionId}`}>Method</Label><Select id={`ipd-payment-method-${admissionId}`} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as ApiPayment["paymentMethod"])}>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method.replaceAll("_", " ")}</option>)}</Select></div>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : paymentPurpose === "DEPOSIT" ? "Record deposit" : "Record payment"}</Button>
            <div className="sm:col-span-2 lg:col-span-4"><Label htmlFor={`ipd-payment-notes-${admissionId}`}>Notes (optional)</Label><Input id={`ipd-payment-notes-${admissionId}`} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></div>
          </form>
        )}

        {canReverse && bill.invoice.items.some((item) => item.serviceCategory === "SERVICES" && !item.reversedAt && !item.sourceType?.includes("CREDIT")) && (
          <div className="rounded-xl border border-[var(--cp-border)] p-3">
            <p className="mb-2 text-sm font-semibold">Correct or reverse a line</p>
            <ul className="flex flex-col gap-2">
              {bill.invoice.items.filter((item) => item.serviceCategory === "SERVICES" && !item.reversedAt && item.sourceType !== "IPD_CREDIT").map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{item.description} · {formatCurrency(itemTotal(item))}</span>
                  <Button size="sm" variant="outline" onClick={() => { setReason(""); setReasonTarget({ kind: "reverse", itemId: item.id }) }}><RotateCcw className="h-4 w-4" /> Reverse</Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canReverse && amount(bill.totals.paid) > 0 && invoice.status !== "VOID" && (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => { setReason(""); setReasonTarget({ kind: "refund" }) }}><RotateCcw className="h-4 w-4" /> Refund payment</Button>
        )}

        <section>
          <h4 className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Payments and refunds</h4>
          {invoice.payments.length === 0 ? <p className="rounded-lg bg-[var(--cp-bg)] px-3 py-2 text-xs text-[var(--cp-ink-soft)]">No payments recorded.</p> : (
            <ul className="flex flex-col gap-2">{invoice.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3">
                <div><p className="text-sm font-medium">{payment.type === "REFUND" ? "Refund" : payment.purpose === "DEPOSIT" ? "Deposit" : "Payment"} · {payment.paymentMethod.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{formatDateTime(payment.paymentDate ?? payment.createdAt)}{payment.reason ? ` · ${payment.reason}` : ""}</p></div>
                <strong className="cp-tabular text-sm">{payment.type === "REFUND" ? "−" : ""}{formatCurrency(amount(payment.amount))}</strong>
              </li>
            ))}</ul>
          )}
        </section>
        <p className="text-right text-xs text-[var(--cp-ink-soft)]">Current calculated balance: {formatCurrency(chargeBalance)}</p>
      </CardContent>

      <Modal open={Boolean(reasonTarget)} onClose={() => { if (!busy) setReasonTarget(null) }} title={reasonTarget?.kind === "refund" ? "Refund IPD payment" : "Reverse IPD bill line"} size="sm">
        <form onSubmit={(event) => void submitReason(event)} className="flex flex-col gap-3">
          {reasonTarget?.kind === "refund" && <div><Label htmlFor={`ipd-refund-amount-${admissionId}`}>Refund amount (PKR)</Label><Input id={`ipd-refund-amount-${admissionId}`} type="number" min="0.01" step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} required /></div>}
          <div><Label htmlFor={`ipd-adjustment-reason-${admissionId}`}>Reason (required)</Label><Textarea id={`ipd-adjustment-reason-${admissionId}`} value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setReasonTarget(null)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !reason.trim()}>{busy ? "Saving…" : "Confirm"}</Button></div>
        </form>
      </Modal>
    </Card>
  )
}
