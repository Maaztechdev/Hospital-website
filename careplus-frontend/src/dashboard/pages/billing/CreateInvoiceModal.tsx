import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Trash2 } from "lucide-react"
import { Modal } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { InvoiceLineItem } from "@/dashboard/types"
import { formatCurrency, generateId } from "@/dashboard/lib/format"
import { api, toInvoice } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

export function CreateInvoiceModal({ open, onClose, prefillMR }: { open: boolean; onClose: () => void; prefillMR?: string }) {
  const { patients, dispatch } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [mrNumber, setMrNumber] = React.useState(prefillMR ?? "")
  const [items, setItems] = React.useState<InvoiceLineItem[]>([{ id: generateId("li"), category: "Consultation", description: "", qty: 1, unitPrice: 0, discount: 0 }])

  React.useEffect(() => {
    if (open) { setMrNumber(prefillMR ?? ""); setItems([{ id: generateId("li"), category: "Consultation", description: "", qty: 1, unitPrice: 0, discount: 0 }]) }
  }, [open, prefillMR])

  const patient = patients.find((p) => p.mrNumber === mrNumber)
  const total = items.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)

  function updateItem(id: string, patch: Partial<InvoiceLineItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }
  function addItem() {
    setItems((prev) => [...prev, { id: generateId("li"), category: "Other", description: "", qty: 1, unitPrice: 0, discount: 0 }])
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function save() {
    if (!patient) { toast({ title: "Select a valid patient (MR number)", variant: "error" }); return }
    if (items.every((i) => !i.description.trim())) { toast({ title: "Add at least one line item", variant: "error" }); return }
    try {
      const created = await api.createInvoice({ patientId: patient.id!, items: items.filter((i) => i.description.trim()).map((item) => ({ itemType: item.category.toUpperCase() as "CONSULTATION" | "LAB" | "MEDICINE" | "WARD" | "OT" | "OTHER", description: item.description.trim(), quantity: item.qty, unitPrice: item.unitPrice, discount: item.discount })) })
      const fresh = await api.getInvoice(created.id)
      dispatch({ type: "UPSERT_INVOICE", invoice: toInvoice(fresh, patient) })
      toast({ title: "Invoice created", description: `${fresh.invoiceNumber} raised for ${patient.name}.`, variant: "success" })
      onClose()
      navigate(`/dashboard/billing/${fresh.id}`)
    } catch (error) {
      toast({ title: "Unable to create invoice", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Invoice" size="xl">
      <div className="mb-4">
        <Label>Patient (MR Number)</Label>
        <Input value={mrNumber} onChange={(e) => setMrNumber(e.target.value)} placeholder="e.g. MR-2026-000101" />
        {patient ? <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{patient.name} · {patient.age} yrs</p> : mrNumber && <p className="mt-1 text-xs text-[var(--cp-critical)]">No matching patient found.</p>}
      </div>

      <div className="flex flex-col gap-3">
        {items.map((li) => (
          <div key={li.id} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--cp-border)] p-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-2"><Label>Category</Label>
              <Select value={li.category} onChange={(e) => updateItem(li.id, { category: e.target.value as InvoiceLineItem["category"] })}>
                <option>Consultation</option><option>Lab</option><option>Medicine</option><option>Ward</option><option>OT</option><option>Other</option>
              </Select>
            </div>
            <div className="sm:col-span-4"><Label>Description</Label><Input value={li.description} onChange={(e) => updateItem(li.id, { description: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Qty</Label><Input type="number" className="cp-tabular" value={li.qty} onChange={(e) => updateItem(li.id, { qty: Number(e.target.value) || 0 })} /></div>
            <div className="sm:col-span-2"><Label>Unit Price</Label><Input type="number" className="cp-tabular" value={li.unitPrice} onChange={(e) => updateItem(li.id, { unitPrice: Number(e.target.value) || 0 })} /></div>
            <div className="sm:col-span-1"><Label>Disc.</Label><Input type="number" className="cp-tabular" value={li.discount} onChange={(e) => updateItem(li.id, { discount: Number(e.target.value) || 0 })} /></div>
            <div className="flex items-center justify-between sm:col-span-1">
              <span className="cp-tabular text-sm font-semibold">{formatCurrency(li.qty * li.unitPrice - li.discount)}</span>
              <button onClick={() => removeItem(li.id)} aria-label="Remove line" className="rounded-lg p-1.5 text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" className="mt-3" onClick={addItem}><Plus className="h-4 w-4" /> Add Line Item</Button>

      <div className="mt-4 flex items-center justify-between border-t border-[var(--cp-border)] pt-4">
        <p className="text-sm font-semibold text-[var(--cp-ink)]">Grand Total</p>
        <p className="cp-tabular text-xl font-bold text-[var(--cp-primary)]">{formatCurrency(total)}</p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save}>Save Invoice</Button>
      </div>
    </Modal>
  )
}
