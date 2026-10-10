import * as React from "react"
import { useNavigate } from "react-router-dom"
import { LoaderCircle, Plus, Trash2 } from "lucide-react"
import { Modal } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { InvoiceLineItem, Patient } from "@/dashboard/types"
import { PatientSearchSelect } from "@/dashboard/components/PatientSearchSelect"
import { formatCurrency, generateId } from "@/dashboard/lib/format"
import { api, toInvoice } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

type DiscountType = "FLAT" | "PERCENTAGE"
type InvoiceDraftItem = InvoiceLineItem & { discountType: DiscountType }

export function CreateInvoiceModal({ open, onClose, prefillMR }: { open: boolean; onClose: () => void; prefillMR?: string }) {
  const { patients, dispatch } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [patient, setPatient] = React.useState<Patient | null>(null)
  const [items, setItems] = React.useState<InvoiceDraftItem[]>([{ id: generateId("li"), category: "Consultation", description: "", qty: 1, unitPrice: 0, discount: 0, discountType: "FLAT" }])
  const [activeWardRate, setActiveWardRate] = React.useState<number | null>(null)
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  const initializedForRef = React.useRef<string | null>(null)

  function normalizeNumericInput(value: string): number {
    if (value.trim().startsWith("-")) return 0
    const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
    const parsed = Number(digits || 0)
    return Number.isSafeInteger(parsed) ? parsed : 0
  }

  function blockInvalidNumberKeys(event: React.KeyboardEvent<HTMLInputElement>) {
    if (["e", "E", "+", "-", ".", ","].includes(event.key)) event.preventDefault()
  }

  function roundPkr(amount: number): number {
    return Math.round(amount)
  }

  function getDiscountAmount(item: InvoiceDraftItem): number {
    const lineAmount = roundPkr(item.qty * item.unitPrice)
    return item.discountType === "PERCENTAGE"
      ? roundPkr(lineAmount * item.discount / 100)
      : roundPkr(item.discount)
  }

  function getItemErrors(item: InvoiceDraftItem) {
    return {
      description: item.description.trim() ? "" : "Description is required.",
      quantity: Number.isInteger(item.qty) && item.qty >= 1 ? "" : "Quantity must be a whole number of at least 1.",
      unitPrice: Number.isInteger(item.unitPrice) && item.unitPrice > 0 ? "" : "Unit price must be greater than 0.",
      discount: item.discountType === "PERCENTAGE"
        ? item.discount >= 0 && item.discount <= 100 ? "" : "Percentage must be between 0 and 100."
        : item.discount >= 0 && getDiscountAmount(item) <= roundPkr(item.qty * item.unitPrice) ? "" : "Discount cannot exceed the line amount.",
    }
  }

  React.useEffect(() => {
    if (!open) { initializedForRef.current = null; return }
    const prefillKey = prefillMR ?? ""
    if (initializedForRef.current === prefillKey) return
    initializedForRef.current = prefillKey
    setPatient(patients.find((candidate) => candidate.mrNumber === prefillMR) ?? null)
    setItems([{ id: generateId("li"), category: "Consultation", description: "", qty: 1, unitPrice: 0, discount: 0, discountType: "FLAT" }])
  }, [open, prefillMR, patients])

  React.useEffect(() => {
    if (!patient?.id) { setActiveWardRate(null); return }
    let cancelled = false
    api.listAdmissions("ACTIVE", patient.id).then((admissions) => {
      if (cancelled) return
      const rate = admissions[0]?.bed?.dailyRate
      setActiveWardRate(rate == null ? null : Number(rate))
    }).catch((cause) => { if (!cancelled) { setActiveWardRate(null); toast({ title: "Unable to load active ward rate", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }) } })
    return () => { cancelled = true }
  }, [patient?.id, toast])

  React.useEffect(() => {
    if (activeWardRate == null || !patient) return
    setItems((current) => current.some((item) => item.category === "Ward" && item.unitPrice > 0) ? current : current.map((item, index) => index === 0 ? { ...item, category: "Ward", description: "Ward stay (daily rate)", unitPrice: roundPkr(activeWardRate) } : item))
  }, [activeWardRate, patient])

  const subtotal = roundPkr(items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0))
  const totalDiscount = roundPkr(items.reduce((sum, item) => sum + getDiscountAmount(item), 0))
  const total = roundPkr(subtotal - totalDiscount)
  const itemErrors = items.map(getItemErrors)
  const validItemsCount = itemErrors.filter((errors) => Object.values(errors).every((message) => !message)).length
  const formIsValid = Boolean(patient?.id) && items.length > 0 && validItemsCount === items.length

  function updateItem(id: string, patch: Partial<InvoiceDraftItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }
  function addItem() {
    setItems((prev) => [...prev, { id: generateId("li"), category: "Other", description: "", qty: 1, unitPrice: 0, discount: 0, discountType: "FLAT" }])
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function save() {
    if (!formIsValid || !patient?.id || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const created = await api.createInvoice({ patientId: patient.id, items: items.map((item) => ({ itemType: item.category.toUpperCase() as "CONSULTATION" | "LAB" | "MEDICINE" | "WARD" | "OT" | "OTHER", description: item.description.trim(), quantity: item.qty, unitPrice: item.unitPrice, discount: item.discount, discountType: item.discountType })) })
      const fresh = await api.getInvoice(created.id)
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patient) })
      toast({ title: "Invoice created", description: `${fresh.invoiceNumber} raised for ${patient.name}.`, variant: "success" })
      onClose()
      navigate(`/dashboard/billing/${fresh.id}`)
    } catch (error) {
      toast({ title: "Unable to create invoice", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Invoice"
      size="xl"
      className="sm:max-w-[840px]"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || !formIsValid}>{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Save Invoice</Button>
        </div>
      )}
    >
      <PatientSearchSelect value={patient} onChange={setPatient} prefillMR={prefillMR} error={!patient?.id ? "Select a patient." : undefined} />

      <div className="mb-2 mt-4 hidden grid-cols-[160px_minmax(130px,1fr)_70px_110px_130px_100px_40px] gap-2 border-b border-[var(--cp-border)] pb-2 text-xs font-semibold text-[var(--cp-ink-soft)] lg:grid">
        <span>Category</span>
        <span>Description</span>
        <span>Qty</span>
        <span>Unit Price</span>
        <span>Discount</span>
        <span className="text-right">Line Total</span>
        <span aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        {items.map((li, index) => (
          <React.Fragment key={li.id}>
          <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2 rounded-lg border border-[var(--cp-border)] p-3 lg:grid-cols-[160px_minmax(130px,1fr)_70px_110px_130px_100px_40px] lg:gap-2 lg:rounded-none lg:border-0 lg:border-b lg:px-0 lg:py-2">
            <div className="col-span-2 min-w-0 lg:col-span-1">
              <Label className="mb-1 block text-xs text-[var(--cp-ink-soft)] lg:sr-only">Category</Label>
              <Select className="min-w-0 px-3 pr-8 text-sm" value={li.category} onChange={(e) => updateItem(li.id, { category: e.target.value as InvoiceLineItem["category"] })}>
                <option value="Consultation">Consultation</option>
                <option value="Lab">Lab</option>
                <option value="Medicine">Pharmacy</option>
                <option value="Ward">Ward</option>
                <option value="OT">OT</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="col-span-2 min-w-0 lg:col-span-1">
              <Label className="mb-1 block text-xs text-[var(--cp-ink-soft)] lg:sr-only">Description</Label>
              <Input value={li.description} aria-invalid={!!itemErrors[index].description} onChange={(e) => updateItem(li.id, { description: e.target.value })} />
              {itemErrors[index].description && <p className="mt-1 text-[10px] text-[var(--cp-critical)]">{itemErrors[index].description}</p>}
            </div>
            <div className="min-w-0">
              <Label className="mb-1 block text-xs text-[var(--cp-ink-soft)] lg:sr-only">Qty</Label>
              <Input type="number" min={1} step={1} inputMode="numeric" className="cp-tabular px-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={li.qty} aria-invalid={!!itemErrors[index].quantity} onKeyDown={blockInvalidNumberKeys} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => updateItem(li.id, { qty: normalizeNumericInput(e.target.value) })} />
              {itemErrors[index].quantity && <p className="mt-1 text-[10px] text-[var(--cp-critical)]">{itemErrors[index].quantity}</p>}
            </div>
            <div className="min-w-0">
              <Label className="mb-1 block text-xs text-[var(--cp-ink-soft)] lg:sr-only">Unit Price</Label>
              <Input type="number" min={0} step={1} inputMode="numeric" className="cp-tabular px-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={li.unitPrice} aria-invalid={!!itemErrors[index].unitPrice} onKeyDown={blockInvalidNumberKeys} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => updateItem(li.id, { unitPrice: normalizeNumericInput(e.target.value) })} />
              {itemErrors[index].unitPrice && <p className="mt-1 text-[10px] text-[var(--cp-critical)]">{itemErrors[index].unitPrice}</p>}
              {li.category === "Ward" && activeWardRate != null && <p className="mt-1 text-[10px] text-[var(--cp-ink-soft)]">From active admission</p>}
            </div>
            <div className="min-w-0">
              <Label className="mb-1 block text-xs text-[var(--cp-ink-soft)] lg:sr-only">Discount</Label>
              <div className="mb-1 flex w-fit overflow-hidden rounded-md border border-[var(--cp-border)] text-[10px] font-semibold">
                {(["FLAT", "PERCENTAGE"] as const).map((discountType) => (
                  <button key={discountType} type="button" aria-pressed={li.discountType === discountType} onClick={() => updateItem(li.id, { discountType })} className={`px-2 py-1 ${li.discountType === discountType ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]"}`}>
                    {discountType === "FLAT" ? "PKR" : "%"}
                  </button>
                ))}
              </div>
              <Input type="number" min={0} max={li.discountType === "PERCENTAGE" ? 100 : undefined} step={1} inputMode="numeric" className="cp-tabular px-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={li.discount} aria-invalid={!!itemErrors[index].discount} onKeyDown={blockInvalidNumberKeys} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => updateItem(li.id, { discount: normalizeNumericInput(e.target.value) })} />
              {itemErrors[index].discount && <p className="mt-1 text-[10px] text-[var(--cp-critical)]">{itemErrors[index].discount}</p>}
            </div>
            <div className="col-span-2 flex min-h-9 items-center justify-end lg:col-span-1">
              <span className="mr-2 cp-tabular text-right text-sm font-bold text-[var(--cp-ink)]">{formatCurrency(roundPkr(li.qty * li.unitPrice) - getDiscountAmount(li))}</span>
              {items.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeItem(li.id)}
                  title="Remove item"
                  aria-label="Remove item"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--cp-border)] text-[var(--cp-critical)] transition-colors hover:border-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-critical)]"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              ) : <span className="h-9 w-9 shrink-0" aria-hidden="true" />}
            </div>
          </div>
          </React.Fragment>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addItem}><Plus className="h-4 w-4" /> Add Line Item</Button>

      <div className="mt-4 flex justify-end border-t border-[var(--cp-border)] pt-3">
        <dl className="grid min-w-60 grid-cols-2 gap-x-8 gap-y-1 text-right text-sm">
          <dt className="text-[var(--cp-ink-soft)]">Subtotal</dt>
          <dd className="cp-tabular font-medium">{formatCurrency(subtotal)}</dd>
          <dt className="text-[var(--cp-ink-soft)]">Total Discount</dt>
          <dd className="cp-tabular font-medium">{formatCurrency(totalDiscount)}</dd>
          <dt className="pt-2 font-semibold text-[var(--cp-ink)]">Grand Total</dt>
          <dd className="cp-tabular pt-2 text-lg font-bold text-[var(--cp-primary)]">{formatCurrency(total)}</dd>
        </dl>
      </div>
    </Modal>
  )
}
