import * as React from "react"
import { RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiIpdWardAdmission, type ApiWardMedicineOrder } from "@/lib/api"

export default function WardMedicineIssuePanel() {
  const { toast } = useToast()
  const [admissions, setAdmissions] = React.useState<ApiIpdWardAdmission[]>([])
  const [admissionId, setAdmissionId] = React.useState("")
  const [orders, setOrders] = React.useState<ApiWardMedicineOrder[]>([])
  const [loadingAdmissions, setLoadingAdmissions] = React.useState(true)
  const [loadingOrders, setLoadingOrders] = React.useState(false)
  const [error, setError] = React.useState("")
  const [busyOrder, setBusyOrder] = React.useState("")
  const [returnTarget, setReturnTarget] = React.useState<{ itemId: string; max: number } | null>(null)
  const [returnQuantity, setReturnQuantity] = React.useState("1")
  const [returnReason, setReturnReason] = React.useState("")

  const loadAdmissions = React.useCallback(async () => {
    setLoadingAdmissions(true)
    setError("")
    try {
      const result = await api.listWardAdmissions()
      setAdmissions(result)
      setAdmissionId((current) => result.some((admission) => admission.id === current) ? current : result[0]?.id ?? "")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to load active admissions."
      setError(message)
      toast({ title: "Unable to load admissions", description: message, variant: "error" })
    } finally {
      setLoadingAdmissions(false)
    }
  }, [toast])

  const loadOrders = React.useCallback(async () => {
    if (!admissionId) {
      setOrders([])
      return
    }
    setLoadingOrders(true)
    setError("")
    try {
      setOrders(await api.listWardMedicineOrders(admissionId))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to load ward medicine orders."
      setError(message)
      toast({ title: "Unable to load ward orders", description: message, variant: "error" })
    } finally {
      setLoadingOrders(false)
    }
  }, [admissionId, toast])

  React.useEffect(() => { void loadAdmissions() }, [loadAdmissions])
  React.useEffect(() => { void loadOrders() }, [loadOrders])

  async function issue(orderId: string) {
    if (!admissionId) return
    setBusyOrder(orderId)
    try {
      await api.issueWardMedicineOrder(admissionId, orderId)
      await loadOrders()
      toast({ title: "Ward medicines issued", description: "Stock was allocated from earliest-expiring eligible batches.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to issue ward medicines", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusyOrder("")
    }
  }

  async function submitReturn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!admissionId || !returnTarget || !returnReason.trim()) return
    const quantity = Number(returnQuantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > returnTarget.max) return
    setBusyOrder(returnTarget.itemId)
    try {
      await api.returnWardMedicine(admissionId, returnTarget.itemId, { quantity, reason: returnReason.trim() })
      setReturnTarget(null)
      setReturnQuantity("1")
      setReturnReason("")
      await loadOrders()
      toast({ title: "Ward medicine return recorded", description: "Stock and the IPD invoice were updated without deleting history.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to return ward medicine", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusyOrder("")
    }
  }

  const selectedAdmission = admissions.find((admission) => admission.id === admissionId)

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Issue to ward</CardTitle>
          <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Fulfill Doctor or Nurse orders. Eligible stock is deducted by FEFO; the batch allocation is recorded on issue.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { void loadAdmissions(); void loadOrders() }} disabled={loadingAdmissions || loadingOrders}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Label htmlFor="ward-medicine-admission">Active admission</Label>
          <Select id="ward-medicine-admission" value={admissionId} onChange={(event) => setAdmissionId(event.target.value)} disabled={loadingAdmissions || admissions.length === 0}>
            <option value="">{loadingAdmissions ? "Loading admissions…" : "Select an admission"}</option>
            {admissions.map((admission) => <option key={admission.id} value={admission.id}>{admission.patient.firstName} {admission.patient.lastName} · {admission.patient.mrNumber} · {admission.bed.bedNumber}</option>)}
          </Select>
        </div>
        {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-critical)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void loadOrders()}>Retry</Button></div>}
        {!loadingAdmissions && admissions.length === 0 && <p className="rounded-lg bg-[var(--cp-bg)] p-4 text-sm text-[var(--cp-ink-soft)]">There are no active admissions.</p>}
        {selectedAdmission && (
          <div className="rounded-lg bg-[var(--cp-bg)] p-3 text-xs text-[var(--cp-ink-soft)]">
            {selectedAdmission.patient.firstName} {selectedAdmission.patient.lastName} · {selectedAdmission.patient.mrNumber} · {selectedAdmission.bed.room.ward.wardName}, {selectedAdmission.bed.bedNumber}
          </div>
        )}
        {loadingOrders && <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading ward orders…</p>}
        {!loadingOrders && admissionId && orders.length === 0 && !error && <p className="rounded-lg bg-[var(--cp-bg)] p-4 text-sm text-[var(--cp-ink-soft)]">No medicine orders have been placed for this admission.</p>}
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <article key={order.id} className="rounded-xl border border-[var(--cp-border)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--cp-ink)]">{order.orderNote}</p>
                  <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{formatDateTime(order.createdAt)} · {order.issuedAt ? `Issued ${formatDateTime(order.issuedAt)}` : "Pending issue"}</p>
                </div>
                {!order.issuedAt && <Button size="sm" onClick={() => void issue(order.id)} disabled={busyOrder === order.id || loadingOrders}>{busyOrder === order.id ? "Issuing…" : "Issue by FEFO"}</Button>}
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {order.items.map((item) => {
                  const remaining = Math.max(0, item.issuedQuantity - item.returnedQuantity)
                  return (
                    <li key={item.id} className="rounded-lg bg-[var(--cp-bg)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{item.medicine.name}{item.medicine.strength ? ` · ${item.medicine.strength}` : ""}{item.medicine.form ? ` · ${item.medicine.form}` : ""}</p>
                        <p className="cp-tabular text-xs text-[var(--cp-ink-soft)]">Ordered {item.quantity}{order.issuedAt ? ` · Issued ${item.issuedQuantity} · Returned ${item.returnedQuantity}` : ""}</p>
                      </div>
                      {order.issuedAt && item.fefoBatches && item.fefoBatches.length > 0 && (
                        <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">FEFO batches: {item.fefoBatches.map((batch) => `${batch.batchNumber} (${batch.quantity}, expires ${formatDate(batch.expiryDate)})`).join("; ")}</p>
                      )}
                      {order.issuedAt && remaining > 0 && (
                        <div className="mt-2">
                          {returnTarget?.itemId === item.id ? (
                            <form onSubmit={(event) => void submitReturn(event)} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                              <div><Label htmlFor={`ward-return-qty-${item.id}`}>Qty (max {remaining})</Label><Input id={`ward-return-qty-${item.id}`} type="number" min="1" max={remaining} step="1" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} required /></div>
                              <div><Label htmlFor={`ward-return-reason-${item.id}`}>Reason</Label><Textarea id={`ward-return-reason-${item.id}`} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={500} required /></div>
                              <div className="flex items-end gap-2"><Button type="submit" size="sm" disabled={busyOrder === item.id || !returnReason.trim()}>Record return</Button><Button type="button" size="sm" variant="outline" onClick={() => setReturnTarget(null)}>Cancel</Button></div>
                            </form>
                          ) : <Button size="sm" variant="outline" onClick={() => { setReturnTarget({ itemId: item.id, max: remaining }); setReturnQuantity("1"); setReturnReason("") }}><RotateCcw className="h-4 w-4" /> Return medicine</Button>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
