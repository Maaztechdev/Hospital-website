import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Package, AlertTriangle, Clock3, Wallet, Plus, History, RotateCcw, Printer, FileText, ShoppingCart, X, BarChart3, Receipt, ArrowRight, CircleDollarSign, ChevronDown, ChevronRight, Archive } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect, Modal, Tabs } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import { api, type ApiMedicine, type ApiMedicineBatch, type ApiMedicineCategory, type ApiCreateMedicineInput, type ApiPharmacyOverview, type ApiPharmacySale, type ApiPharmacySettings, type ApiPrescription, type ApiStockMovement } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { InvoicePrintDocument, PrescriptionPrintDocument, type PrintLayout } from "./PharmacyPrintDocuments"

type PharmacyMedicine = ApiMedicine & { currentStock: number; availableStock: number; reorderLevel: number; sellingPrice: number; status: "In Stock" | "Low Stock" | "Out of Stock" | "Near Expiry" | "Expired"; batchNumber: string; expiryDate: string }

function toMedicine(medicine: ApiMedicine): PharmacyMedicine {
  const batches = medicine.batches
  const currentStock = batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date())
  const sellableBatches = batches.filter((batch) => batch.expiryDate.slice(0, 10) >= today && batch.stockQuantity > 0)
  const earliest = sellableBatches[0] ?? batches[0]
  const availableStock = sellableBatches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
  const reorderLevel = batches.reduce((sum, batch) => sum + batch.reorderLevel, 0)
  const sellingPrice = Number(earliest?.sellingPrice ?? 0)
  const expiryDate = earliest?.expiryDate ?? new Date().toISOString()
  const daysToExpiry = (new Date(expiryDate).getTime() - Date.now()) / 86400000
  const status = availableStock <= 0 ? currentStock > 0 ? "Expired" : "Out of Stock" : daysToExpiry <= 30 ? "Near Expiry" : availableStock <= reorderLevel ? "Low Stock" : "In Stock"
  return { ...medicine, currentStock, availableStock, reorderLevel, sellingPrice, expiryDate, batchNumber: earliest?.batchNumber ?? "—", status }
}

function batchIsExpired(batch: ApiMedicineBatch) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date())
  return batch.expiryDate.slice(0, 10) < today
}

function toMovement(movement: ApiStockMovement) {
  const type = movement.movementType === "IN" ? "Stock In" : movement.movementType === "OUT" ? "Dispense" : movement.movementType === "RETURN" ? "Return" : movement.movementType === "VOID" ? "Void" : movement.movementType === "EXPIRED" ? "Expired write-off" : movement.movementType === "DAMAGED" ? "Damaged write-off" : "Adjustment"
  const quantity = ["OUT", "EXPIRED", "DAMAGED"].includes(movement.movementType) ? -movement.quantity : movement.quantity
  return { id: movement.id, medicineId: movement.batch.medicineId, medicineName: movement.batch.medicine.name, batchNumber: movement.batch.batchNumber, invoiceReference: movement.invoiceReference ?? undefined, invoiceNumber: movement.invoice?.invoiceNumber, patientName: movement.patient ? `${movement.patient.name} (${movement.patient.mrNumber})` : undefined, type, quantity, reason: movement.reason ?? undefined, date: movement.createdAt, staff: movement.createdByUser?.name ?? "Unknown user" } as const
}

function dateToDmy(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`
}

function dmyToIso(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, dayText, monthText, yearText] = match
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)))
  if (date.getUTCDate() !== Number(dayText) || date.getUTCMonth() + 1 !== Number(monthText)) return null
  return `${yearText}-${monthText}-${dayText}`
}

function SaleModal({ open, medicines, onClose, onSaved }: { open: boolean; medicines: PharmacyMedicine[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [medicineId, setMedicineId] = React.useState("")
  const [quantity, setQuantity] = React.useState("1")
  const [cart, setCart] = React.useState<Array<{ medicineId: string; quantity: number; unitPrice: number; discount: number }>>([])
  const [tax, setTax] = React.useState("0")
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET">("CASH")
  const [customerName, setCustomerName] = React.useState("")
  const [customerPhone, setCustomerPhone] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [sale, setSale] = React.useState<ApiPharmacySale | null>(null)
  const [printLayout, setPrintLayout] = React.useState<PrintLayout>("a4")
  const [pharmacySettings, setPharmacySettings] = React.useState<ApiPharmacySettings | null>(null)
  const [printing, setPrinting] = React.useState(false)
  const selected = medicines.find((medicine) => medicine.id === medicineId)
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0)
  const total = subtotal + (Number(tax) || 0)

  React.useEffect(() => { if (open) { setCart([]); setSale(null); setMedicineId(""); setQuantity("1"); setTax("0"); setCustomerName(""); setCustomerPhone("") } }, [open])
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
    if (!printing) return
    const handleAfterPrint = () => setPrinting(false)
    window.addEventListener("afterprint", handleAfterPrint, { once: true })
    const frame = window.requestAnimationFrame(() => window.print())
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("afterprint", handleAfterPrint) }
  }, [printing])
  if (!open) return null
  if (sale) return <><Modal open onClose={onClose} title={`Invoice ${sale.invoice.invoiceNumber}`}><div className="space-y-3 text-sm"><p className="text-[var(--cp-ink-soft)]">Pharmacy sale recorded successfully.</p>{sale.items.map((item) => <div key={item.id} className="flex justify-between border-b border-[var(--cp-border)] pb-2"><span>{item.medicine.name} x{item.quantity}</span><span className="cp-tabular">{formatCurrency(Number(item.subtotal))}</span></div>)}<div className="flex justify-between pt-2 font-semibold"><span>Total</span><span className="cp-tabular">{formatCurrency(Number(sale.totalAmount))}</span></div></div><div className="mt-5 flex items-center justify-between gap-2"><label className="text-xs text-[var(--cp-ink-soft)]">Print format<select value={printLayout} onChange={(event) => setPrintLayout(event.target.value as PrintLayout)} className="ml-2 rounded border border-[var(--cp-border)] px-2 py-1 text-xs"><option value="a4">A4</option><option value="receipt">80mm receipt</option></select></label><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onClose}>Done</Button><Button size="sm" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Print Invoice</Button></div></div></Modal>{printing && <InvoicePrintDocument sale={sale} layout={printLayout} pharmacySettings={pharmacySettings} />}</>
  return <Modal open onClose={onClose} title="New Pharmacy Sale" size="lg">
    <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <div className="space-y-3"><Label>Medicine</Label><select value={medicineId} onChange={(event) => setMedicineId(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="">Select medicine...</option>{medicines.filter((medicine) => medicine.availableStock > 0).map((medicine) => <option key={medicine.id} value={medicine.id}>{medicine.name} | {medicine.availableStock} available | expires {formatDate(medicine.expiryDate)}</option>)}</select>{selected && <p className="text-xs text-[var(--cp-ink-soft)]">FEFO will use {selected.batchNumber} first, expiry {formatDate(selected.expiryDate)}. Available: {selected.availableStock}.</p>}<div className="flex gap-2"><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><Button type="button" size="sm" disabled={!selected} onClick={() => { const n = Number(quantity); if (!selected || !n || n < 1 || n > selected.availableStock) return; setCart((items) => { const existing = items.find((item) => item.medicineId === selected.id); return existing ? items.map((item) => item.medicineId === selected.id ? { ...item, quantity: item.quantity + n } : item) : [...items, { medicineId: selected.id, quantity: n, unitPrice: selected.sellingPrice, discount: 0 } ] }); setMedicineId(""); setQuantity("1") }}><ShoppingCart className="h-4 w-4" /> Add</Button></div></div>
      <div className="space-y-3"><Label>Customer (optional)</Label><Input placeholder="Walk-in customer name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><Input placeholder="Phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /><Label>Payment method</Label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option></select><Label>Tax</Label><Input type="number" min="0" value={tax} onChange={(event) => setTax(event.target.value)} /></div>
    </div>
    <div className="mt-5 space-y-2 border-t border-[var(--cp-border)] pt-4"><Label>Cart</Label>{cart.length === 0 && <p className="text-sm text-[var(--cp-ink-soft)]">Add one or more medicines.</p>}{cart.map((item) => { const medicine = medicines.find((candidate) => candidate.id === item.medicineId); return <div key={item.medicineId} className="flex items-center justify-between gap-2 text-sm"><span>{medicine?.name} x{item.quantity}</span><span className="cp-tabular">{formatCurrency(item.quantity * item.unitPrice - item.discount)} <button type="button" aria-label="Remove item" onClick={() => setCart((items) => items.filter((candidate) => candidate.medicineId !== item.medicineId))}><X className="inline h-4 w-4" /></button></span></div>})}<div className="flex justify-between border-t border-[var(--cp-border)] pt-2 font-semibold"><span>Total</span><span className="cp-tabular">{formatCurrency(total)}</span></div></div>
    <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={saving || cart.length === 0} onClick={async () => { setSaving(true); try { const created = await api.createPharmacySale({ items: cart, tax: Number(tax) || 0, paymentMethod, customerName: customerName.trim() || undefined, customerPhone: customerPhone.trim() || undefined }); await onSaved(); setSale(created); toast({ title: "Sale recorded", description: `Invoice ${created.invoice.invoiceNumber} generated.`, variant: "success" }) } catch (caught) { toast({ title: "Sale failed", description: caught instanceof Error ? caught.message : "Unable to record sale", variant: "error" }) } finally { setSaving(false) } }}>{saving ? "Processing..." : "Complete Sale"}</Button></div>
  </Modal>
}

function AddMedicineModal({ open, medicine, onClose, onSaved }: { open: boolean; medicine?: PharmacyMedicine | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [categories, setCategories] = React.useState<ApiMedicineCategory[]>([])
  const [form, setForm] = React.useState({ name: "", genericName: "", barcode: "", strength: "", form: "", categoryId: "", manufacturer: "", unitType: "TABLET" as NonNullable<ApiMedicine["unitType"]>, batchNumber: "", expiryDate: "", currentStock: "0", reorderLevel: "10", purchasePrice: "", sellingPrice: "" })
  React.useEffect(() => {
    if (!open) return
    const firstBatch = medicine?.batches[0]
    setForm({
      name: medicine?.name ?? "",
      genericName: medicine?.genericName ?? "",
      barcode: medicine?.barcode ?? "",
      strength: medicine?.strength ?? "",
      form: medicine?.form ?? "",
      categoryId: medicine?.categoryId ?? "",
      manufacturer: medicine?.manufacturer ?? "",
      unitType: medicine?.unitType ?? "TABLET",
      batchNumber: medicine ? "" : "",
      expiryDate: medicine ? "" : "",
      currentStock: "0",
      reorderLevel: "10",
      purchasePrice: firstBatch ? String(firstBatch.purchasePrice) : "",
      sellingPrice: firstBatch ? String(firstBatch.sellingPrice) : "",
    })
  }, [medicine, open])
  React.useEffect(() => { if (open) void api.listPharmacyCategories().then(setCategories).catch((caught) => toast({ title: "Unable to load categories", description: caught instanceof Error ? caught.message : "Unable to load medicine categories", variant: "error" })) }, [open, toast])
  return (
    <Modal open={open} onClose={onClose} title={medicine ? "Edit Medicine" : "Add Medicine"}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Medicine name" /></div>
        <div><Label>Generic Name</Label><Input value={form.genericName} onChange={(e) => setForm((f) => ({ ...f, genericName: e.target.value }))} placeholder="Generic name" /></div>
        <div><Label>Barcode</Label><Input value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} placeholder="Scan or enter barcode" /></div>
        <div><Label>Strength</Label><Input value={form.strength} onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))} placeholder="e.g. strength and unit" /></div>
        <div><Label>Dosage form</Label><Input value={form.form} onChange={(e) => setForm((f) => ({ ...f, form: e.target.value }))} placeholder="Dosage form details" /></div>
        <div><Label>Unit type *</Label><select value={form.unitType} onChange={(e) => setForm((f) => ({ ...f, unitType: e.target.value as typeof f.unitType }))} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="TABLET">Tablet</option><option value="CAPSULE">Capsule</option><option value="SYRUP">Syrup</option><option value="INJECTION">Injection</option><option value="STRIP">Strip</option></select></div>
        <div><Label>Manufacturer</Label><Input value={form.manufacturer} onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))} placeholder="Manufacturer name" /></div>
        <div><Label>Category</Label><select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        {!medicine && <><div><Label>Opening batch no. *</Label><Input id="opening-batch-reference" name="openingBatchReference" autoComplete="off" value={form.batchNumber} onChange={(e) => setForm((f) => ({ ...f, batchNumber: e.target.value }))} placeholder="Manufacturer batch number" /></div>
        <div><Label>Expiry date (DD/MM/YYYY) *</Label><Input value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} placeholder="DD/MM/YYYY" inputMode="numeric" /></div>
        <div><Label>Opening stock</Label><Input type="number" min="0" className="cp-tabular" value={form.currentStock} onChange={(e) => setForm((f) => ({ ...f, currentStock: e.target.value }))} placeholder="0" /></div>
        <div><Label>Reorder level</Label><Input type="number" min="0" className="cp-tabular" value={form.reorderLevel} onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))} placeholder="0" /></div></>}
        {!medicine && <><div><Label>Cost price (PKR) *</Label><Input type="number" min="0" className="cp-tabular" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} placeholder="0.00" /></div>
        <div><Label>Selling price (PKR) *</Label><Input type="number" min="0" className="cp-tabular" value={form.sellingPrice} onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} placeholder="0.00" /></div></>}
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={async () => {
            const expiryDate = dmyToIso(form.expiryDate)
            if (!form.name.trim() || !form.unitType || (!medicine && (form.purchasePrice === "" || form.sellingPrice === "" || !form.batchNumber.trim() || !expiryDate))) {
              toast({ title: "Complete all required fields", description: "Name, unit type, cost and selling prices, and opening batch details are required.", variant: "error" }); return
            }
            setSaving(true); setError(null)
            try {
              const payload: ApiCreateMedicineInput = {
                name: form.name.trim(),
                genericName: form.genericName.trim() || undefined,
                barcode: form.barcode.trim() || null,
                strength: form.strength.trim() || undefined,
                form: form.form.trim() || undefined,
                unitType: form.unitType,
                manufacturer: form.manufacturer.trim() || undefined,
                categoryId: form.categoryId || undefined,
                ...(!medicine && expiryDate ? { initialBatch: {
                  batchNumber: form.batchNumber.trim(),
                  expiryDate,
                  purchasePrice: Number(form.purchasePrice),
                  sellingPrice: Number(form.sellingPrice),
                  stockQuantity: Math.max(0, Number(form.currentStock) || 0),
                  reorderLevel: Math.max(0, Number(form.reorderLevel) || 0),
                } } : {}),
              }
              const savedMedicine = medicine ? await api.updateMedicine(medicine.id, payload) : await api.createMedicine(payload)
              await onSaved(); toast({ title: medicine ? "Medicine updated" : "Medicine added", description: `${form.name} ${medicine ? "updated" : "added to inventory"}.`, variant: "success" }); onClose()
            } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to add medicine"; setError(message); toast({ title: "Unable to add medicine", description: message, variant: "error" })
            } finally { setSaving(false) }
          }}
          disabled={saving}
        >
          {saving ? "Saving…" : medicine ? "Save Changes" : "Save Medicine"}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function StockInModal({ medicine, onClose, onSaved }: { medicine: PharmacyMedicine | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [batchId, setBatchId] = React.useState("")
  const [form, setForm] = React.useState({ batchNumber: "", expiryDate: "", quantity: "", purchasePrice: "", sellingPrice: "", supplierName: "", invoiceReference: "" })
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    setBatchId("")
    setForm({ batchNumber: "", expiryDate: "", quantity: "", purchasePrice: "", sellingPrice: "", supplierName: "", invoiceReference: "" })
    setError(null)
  }, [medicine])
  if (!medicine) return null
  return (
    <Modal open={!!medicine} onClose={onClose} title={`Stock In — ${medicine.name}`} size="sm">
      <div className="space-y-3">
        <div><Label>Batch</Label><select value={batchId} onChange={(event) => {
          const selectedBatch = medicine.batches.find((batch) => batch.id === event.target.value)
          setBatchId(event.target.value)
          if (selectedBatch) setForm((value) => ({ ...value, batchNumber: selectedBatch.batchNumber, expiryDate: dateToDmy(selectedBatch.expiryDate), purchasePrice: String(selectedBatch.purchasePrice), sellingPrice: String(selectedBatch.sellingPrice), supplierName: selectedBatch.supplier?.name ?? "" }))
          else setForm((value) => ({ ...value, batchNumber: "", expiryDate: "", purchasePrice: "", sellingPrice: "", supplierName: "" }))
        }} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="">Create new batch</option>{medicine.batches.filter((batch) => !batchIsExpired(batch)).map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNumber} · expires {dateToDmy(batch.expiryDate)} · stock {batch.stockQuantity}</option>)}</select></div>
        {!batchId && <>
          <div><Label>Batch number *</Label><Input id="stock-batch-reference" name="stockBatchReference" autoComplete="off" value={form.batchNumber} onChange={(event) => setForm((value) => ({ ...value, batchNumber: event.target.value }))} placeholder="Batch number" /></div>
          <div><Label>Expiry date (DD/MM/YYYY) *</Label><Input value={form.expiryDate} onChange={(event) => setForm((value) => ({ ...value, expiryDate: event.target.value }))} placeholder="DD/MM/YYYY" inputMode="numeric" /></div>
        </>}
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Quantity *</Label><Input type="number" min="1" className="cp-tabular" value={form.quantity} onChange={(event) => setForm((value) => ({ ...value, quantity: event.target.value }))} placeholder="0" /></div>
          <div><Label>Cost price (PKR) *</Label><Input type="number" min="0" className="cp-tabular" value={form.purchasePrice} onChange={(event) => setForm((value) => ({ ...value, purchasePrice: event.target.value }))} placeholder="0.00" /></div>
          <div><Label>Selling price (PKR) *</Label><Input type="number" min="0" className="cp-tabular" value={form.sellingPrice} onChange={(event) => setForm((value) => ({ ...value, sellingPrice: event.target.value }))} placeholder="0.00" /></div>
          <div><Label>Supplier</Label><Input value={form.supplierName} onChange={(event) => setForm((value) => ({ ...value, supplierName: event.target.value }))} placeholder="Supplier name (optional)" /></div>
        </div>
        <div><Label>Supplier invoice reference</Label><Input value={form.invoiceReference} onChange={(event) => setForm((value) => ({ ...value, invoiceReference: event.target.value }))} placeholder="Invoice or receipt reference" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={async () => {
          const quantity = Number(form.quantity)
          const expiryDate = batchId ? undefined : dmyToIso(form.expiryDate)
          if (!Number.isInteger(quantity) || quantity <= 0 || form.purchasePrice === "" || form.sellingPrice === "" || (!batchId && (!form.batchNumber.trim() || !expiryDate))) {
            toast({ title: "Complete the batch stock-in fields", variant: "error" }); return
          }
          setSaving(true); setError(null)
          try {
            const prices = { quantity, purchasePrice: Number(form.purchasePrice), sellingPrice: Number(form.sellingPrice), supplierName: form.supplierName.trim() || undefined, invoiceReference: form.invoiceReference.trim() || undefined }
            if (batchId) await api.stockIn({ batchId, ...prices })
            else await api.stockIn({ medicineId: medicine.id, batchNumber: form.batchNumber.trim(), expiryDate: expiryDate!, ...prices })
            await onSaved(); toast({ title: "Stock updated", description: `${quantity} units added to ${medicine.name}.`, variant: "success" }); onClose()
          }
          catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to update stock"; setError(message); toast({ title: "Stock update failed", description: message, variant: "error" }) }
          finally { setSaving(false) }
        }}>{saving ? "Updating…" : "Confirm Stock In"}</Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function DispensePrescriptionModal({ prescription, medicines, onClose, onSaved }: { prescription: ApiPrescription | null; medicines: PharmacyMedicine[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [quantities, setQuantities] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setQuantities({}); setError(null) }, [prescription?.id])
  if (!prescription) return null
  const catalogItems = prescription.items.filter((item) => item.isCatalogItem && item.medicineId)

  return (
    <Modal open onClose={onClose} title={`Dispense prescription for ${prescription.patient?.firstName ?? "patient"}`}>
      <p className="mb-3 text-sm text-[var(--cp-ink-soft)]">
        {prescription.patient ? `${prescription.patient.firstName} ${prescription.patient.lastName} · MR ${prescription.patient.mrNumber}` : "Patient details unavailable"}
        {prescription.doctor?.user.name ? ` · ${prescription.doctor.user.name}` : ""}
      </p>
      <div className="space-y-3">
        {catalogItems.map((item) => {
          const medicine = medicines.find((candidate) => candidate.id === item.medicineId)
          return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 rounded-xl border border-[var(--cp-border)] p-3">
            <div>
              <p className="font-medium">{item.medicineName}</p>
              <p className="text-xs text-[var(--cp-ink-soft)]">
                {item.doseAmount ?? item.dosage} {item.doseUnit ?? ""} · {item.frequencyCode ?? item.frequency} · {item.durationValue ?? item.durationDays} {item.durationUnit ?? "days"}
              </p>
              <p className={`mt-1 text-xs ${(medicine?.availableStock ?? 0) > 0 ? "text-[var(--cp-ink-soft)]" : "font-medium text-[var(--cp-critical)]"}`}>
                {medicine ? `${medicine.availableStock} non-expired units available; FEFO batches will be used.` : "Medicine is not in the active catalog."}
              </p>
            </div>
            <div><Label htmlFor={`dispense-quantity-${item.id}`}>Quantity *</Label><Input id={`dispense-quantity-${item.id}`} aria-label={`Quantity for ${item.medicineName}`} type="number" min="1" max={medicine?.availableStock ?? 0} className="cp-tabular" value={quantities[item.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></div>
          </div>
        })}
      </div>
      {prescription.items.some((item) => !item.isCatalogItem || !item.medicineId) && <p className="mt-3 text-xs text-amber-800">Manual prescription items require pharmacist review and are not included in automatic stock dispensing.</p>}
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving || catalogItems.length === 0}
          onClick={async () => {
            const items = catalogItems.map((item) => ({ prescriptionItemId: item.id, quantity: Number(quantities[item.id]) }))
            if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
              toast({ title: "Enter a positive quantity for every catalog medicine", variant: "error" }); return
            }
            const stockByPrescriptionItem = new Map(catalogItems.map((item) => [
              item.id,
              medicines.find((medicine) => medicine.id === item.medicineId)?.availableStock ?? 0,
            ]))
            if (items.some((item) => item.quantity > (stockByPrescriptionItem.get(item.prescriptionItemId) ?? 0))) {
              toast({ title: "Quantity exceeds available non-expired stock", variant: "error" }); return
            }
            setSaving(true); setError(null)
            try {
              const result = await api.dispensePrescription(prescription.id, { items })
              await onSaved()
              toast({ title: "Prescription dispensed", description: `Invoice ${result.sale.invoice.invoiceNumber} created.`, variant: "success" })
              onClose()
            }
            catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to dispense medicine"; setError(message); toast({ title: "Dispense failed", description: message, variant: "error" }) }
            finally { setSaving(false) }
          }}
        >
          {saving ? "Dispensing…" : "Dispense and create invoice"}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function AdjustModal({ target, initialOperation = "ADJUSTMENT", onClose, onSaved }: { target: { medicine: PharmacyMedicine; batch: ApiMedicineBatch } | null; initialOperation?: "RETURN" | "ADJUSTMENT" | "DAMAGED" | "EXPIRED"; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [qty, setQty] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [operation, setOperation] = React.useState<"RETURN" | "ADJUSTMENT" | "DAMAGED" | "EXPIRED">(initialOperation)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setQty(""); setReason(""); setOperation(initialOperation); setError(null) }, [target, initialOperation])
  if (!target) return null
  const { medicine, batch } = target
  return (
    <Modal open={!!target} onClose={onClose} title={operation === "EXPIRED" ? `Expire / Write-off — ${medicine.name}` : `Batch adjustment — ${medicine.name} · ${batch.batchNumber}`} size="sm">
      <p className="mb-3 text-xs text-[var(--cp-ink-soft)]">Batch {batch.batchNumber} · current quantity {batch.stockQuantity} · expiry {dateToDmy(batch.expiryDate)}</p>
      <Label>Operation</Label>
      <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)} className="mb-3 h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm">
        <option value="ADJUSTMENT">Adjustment</option>
        <option value="RETURN">Patient return</option>
        <option value="DAMAGED">Write off damaged</option>
        <option value="EXPIRED">Write off expired</option>
      </select>
      <Label>{operation === "RETURN" ? "Quantity to return" : operation === "ADJUSTMENT" ? "Quantity (use negative to reduce stock)" : "Quantity to write off"}</Label>
      <Input type="number" className="cp-tabular" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 5 or -5" />
      <Label className="mt-3">Reason</Label>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient returned unused medicine" />
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={async () => {
            const n = Number(qty)
            if (!n || !reason.trim()) { toast({ title: "Quantity and reason are required", variant: "error" }); return }
            setSaving(true); setError(null)
            try {
              if (operation === "RETURN") await api.returnStock({ batchId: batch.id, quantity: n, reason: reason.trim() })
              else if (operation === "DAMAGED" || operation === "EXPIRED") await api.writeOffStock({ batchId: batch.id, quantity: n, type: operation, reason: reason.trim() })
              else await api.adjustStock({ batchId: batch.id, quantity: n, reason: reason.trim() })
              await onSaved(); toast({ title: "Stock adjusted", description: `${medicine.name} updated by ${n}.`, variant: "success" }); onClose()
            } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to adjust stock"; setError(message); toast({ title: "Stock adjustment failed", description: message, variant: "error" }) }
            finally { setSaving(false) }
          }}
          disabled={saving}
        >
          <RotateCcw className="h-4 w-4" /> Confirm Adjustment
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

export default function PharmacyDashboard({ initialSaleOpen = false }: { initialSaleOpen?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const { currentUser } = useDashboard()
  const [medicines, setMedicines] = React.useState<PharmacyMedicine[]>([])
  const [categories, setCategories] = React.useState<ApiMedicineCategory[]>([])
  const [stockMovements, setStockMovements] = React.useState<ReturnType<typeof toMovement>[]>([])
  const [prescriptions, setPrescriptions] = React.useState<ApiPrescription[]>([])
  const [loading, setLoading] = React.useState(true)
  const [overview, setOverview] = React.useState<ApiPharmacyOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = React.useState(true)
  const [overviewError, setOverviewError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState("Inventory")
  const [search, setSearch] = React.useState(() => new URLSearchParams(location.search).get("search") ?? "")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [categoryFilter, setCategoryFilter] = React.useState("all")
  const [addOpen, setAddOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<PharmacyMedicine | null>(null)
  const [stockInTarget, setStockInTarget] = React.useState<PharmacyMedicine | null>(null)
  const [prescriptionToDispense, setPrescriptionToDispense] = React.useState<ApiPrescription | null>(null)
  const [adjustTarget, setAdjustTarget] = React.useState<{ medicine: PharmacyMedicine; batch: ApiMedicineBatch } | null>(null)
  const [adjustOperation, setAdjustOperation] = React.useState<"RETURN" | "ADJUSTMENT" | "DAMAGED" | "EXPIRED">("ADJUSTMENT")
  const [expandedMedicineId, setExpandedMedicineId] = React.useState<string | null>(null)
  const [saleOpen, setSaleOpen] = React.useState(initialSaleOpen)
  const [printLayout, setPrintLayout] = React.useState<PrintLayout>("a4")
  const [prescriptionToPrint, setPrescriptionToPrint] = React.useState<ApiPrescription | null>(null)

  React.useEffect(() => {
    if (!prescriptionToPrint) return
    const handleAfterPrint = () => setPrescriptionToPrint(null)
    window.addEventListener("afterprint", handleAfterPrint, { once: true })
    const frame = window.requestAnimationFrame(() => window.print())
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("afterprint", handleAfterPrint) }
  }, [prescriptionToPrint])

  const loadPharmacy = React.useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [medicineResponse, movementResponse, signedPrescriptionResponse, dispensedPrescriptionResponse, categoryResponse] = await Promise.all([
        api.listMedicines(search, categoryFilter === "all" ? "" : categoryFilter),
        api.listStockMovements(),
        api.listPrescriptions("SIGNED"),
        api.listPrescriptions("DISPENSED"),
        api.listPharmacyCategories(),
      ])
      setMedicines(medicineResponse.map(toMedicine)); setStockMovements(movementResponse.map(toMovement)); setPrescriptions([...signedPrescriptionResponse, ...dispensedPrescriptionResponse]); setCategories(categoryResponse)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load pharmacy data") }
    finally { setLoading(false) }
  }, [categoryFilter, search])

  const loadOverview = React.useCallback(async () => {
    try {
      const result = await api.getPharmacyOverview()
      setOverview(result)
      setOverviewError(null)
    } catch (caught) {
      setOverviewError(caught instanceof Error ? caught.message : "Unable to load pharmacy overview")
    } finally {
      setOverviewLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadPharmacy() }, [loadPharmacy])
  React.useEffect(() => { void loadOverview() }, [loadOverview])
  React.useEffect(() => {
    setSearch(new URLSearchParams(location.search).get("search") ?? "")
  }, [location.search])
  React.useEffect(() => {
    const refreshAfterMutation = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? ""
      if (!path.startsWith("/pharmacy/")) return
      void loadOverview()
      if (/sales|batches|stock-in|dispense|return|adjust|write-off|invoices/i.test(path)) void loadPharmacy()
    }
    window.addEventListener("careplus:data-invalidated", refreshAfterMutation)
    return () => window.removeEventListener("careplus:data-invalidated", refreshAfterMutation)
  }, [loadOverview, loadPharmacy])

  const filtered = medicines.filter((m) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || m.name.toLowerCase().includes(q) || (m.genericName ?? "").toLowerCase().includes(q) || (m.barcode ?? "").toLowerCase().includes(q) || (m.strength ?? "").toLowerCase().includes(q)
    const matchesStatus = statusFilter === "all" || m.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Pharmacy"
        action={<div className="flex gap-2">{(currentUser?.role === "admin" || currentUser?.role === "pharmacist") && <Button size="sm" onClick={() => navigate("/dashboard/pharmacy/billing")}><ShoppingCart className="h-4 w-4" /> New Sale</Button>}<Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Medicine</Button></div>}
      />

      {loading && <p className="text-sm text-[var(--cp-ink-soft)]">Loading pharmacy data…</p>}
      {error && <div className="flex items-center justify-between rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadPharmacy()}>Retry</Button></div>}
      {overviewError && <div className="flex items-center justify-between rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{overviewError}</span><Button variant="outline" size="sm" onClick={() => void loadOverview()}>Retry overview</Button></div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <div><StatCard label="Today's Sales" value={overviewLoading ? "…" : overview ? formatCurrency(overview.today.sales) : "—"} icon={CircleDollarSign} tone="success" /><p className="px-2 pt-1 text-[10px] text-[var(--cp-ink-soft)]">Asia/Karachi · {overview?.today.date ?? "today"}</p></div>
        <StatCard label="Low Stock Batches" value={overviewLoading ? "…" : overview ? String(overview.lowStock.count) : "—"} icon={AlertTriangle} tone="warning" />
        <StatCard label="Expiring Within 30 Days" value={overviewLoading ? "…" : overview ? String(overview.expiring.count) : "—"} icon={Clock3} tone="warning" />
        <StatCard label="Expired Batches" value={overviewLoading ? "…" : overview ? String(overview.expired.count) : "—"} icon={Package} tone="critical" />
        <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4 cp-shadow">
          <div className="flex items-start justify-between"><span className="text-xs font-medium text-[var(--cp-ink-soft)]">Inventory Value (Cost)</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cp-primary-light)] text-[var(--cp-primary)]"><Wallet className="h-4 w-4" /></span></div>
          <p className="cp-tabular mt-3 text-xl font-bold text-[var(--cp-ink)]">{overviewLoading ? "…" : overview ? formatCurrency(overview.inventoryValue.cost) : "—"}</p>
          <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Selling value {overviewLoading ? "…" : overview ? formatCurrency(overview.inventoryValue.selling) : "—"}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          {(currentUser?.role === "admin" || currentUser?.role === "pharmacist") && <Button onClick={() => navigate("/dashboard/pharmacy/billing")}><ShoppingCart className="h-4 w-4" /> New Sale</Button>}
          <Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Medicine</Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/pharmacy/reports")}><BarChart3 className="h-4 w-4" /> Reports</Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/pharmacy/khata")}><Receipt className="h-4 w-4" /> Khata</Button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Recent Sales</h2><Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/pharmacy/invoices")}>View all <ArrowRight className="h-4 w-4" /></Button></div>
          {overviewLoading ? <p className="text-sm text-[var(--cp-ink-soft)]">Loading recent sales…</p> : !overview ? <p role="alert" className="text-sm text-[var(--cp-critical)]">Overview data is unavailable.</p> : !overview.recentSales.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No pharmacy sales recorded yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Invoice</th><th className="py-2">Time</th><th className="py-2 text-right">Items</th><th className="py-2">Payment</th><th className="py-2 text-right">Amount</th></tr></thead><tbody>{overview.recentSales.map((sale) => <tr key={sale.id} className="border-b last:border-0"><td className="py-2"><button className="font-medium text-[var(--cp-primary)] hover:underline" onClick={() => navigate(`/dashboard/pharmacy/invoices/${sale.invoiceId}`)}>{sale.invoiceNumber}</button></td><td className="whitespace-nowrap py-2">{formatDateTime(sale.createdAt)}</td><td className="py-2 text-right">{sale.itemCount}</td><td className="py-2">{sale.paymentMethod.replaceAll("_", " ")}</td><td className="cp-tabular py-2 text-right">{formatCurrency(sale.amount)}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="rounded-2xl border border-[var(--cp-warning)] bg-[var(--cp-warning-light)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="h-4 w-4" /> Low-stock alerts</h2><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{overview?.lowStock.count ?? "—"}</span></div>
          {overviewLoading ? <p className="text-sm text-[var(--cp-ink-soft)]">Loading low-stock alerts…</p> : !overview ? <p role="alert" className="text-sm text-[var(--cp-critical)]">Overview data is unavailable.</p> : !overview.lowStock.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No low-stock batches.</p> : <ul className="divide-y divide-[var(--cp-warning)]/30">{overview.lowStock.items.map((item) => <li key={`${item.medicineId}-${item.batchNumber}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span><span className="font-medium">{item.medicineName}</span><span className="block text-xs text-[var(--cp-ink-soft)]">Batch {item.batchNumber}</span></span><span className="cp-tabular text-right">{item.stockQuantity} / {item.reorderLevel}<span className="block text-xs text-[var(--cp-ink-soft)]">available / reorder</span></span></li>)}</ul>}
        </section>
      </div>

      <Tabs tabs={["Inventory", "Prescriptions", "Movement History"]} active={tab} onChange={setTab} />

      {tab === "Inventory" && (
        <>
          <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search medicine or generic name…">
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All statuses" }, { value: "In Stock", label: "In Stock" }, { value: "Low Stock", label: "Low Stock" }, { value: "Out of Stock", label: "Out of Stock" }, { value: "Near Expiry", label: "Near Expiry" }, { value: "Expired", label: "Expired stock" }]} />
            <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} options={[{ value: "all", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} />
          </FilterBar>

          <DataTable
            rows={filtered}
            getRowKey={(m) => m.id}
            emptyIcon={Package}
            emptyTitle="No medicines found"
            rowTone={(m) => m.status === "Expired" ? "critical" : toneFor(m.status)}
            columns={[
              { key: "name", header: "Medicine", render: (m) => <div className="min-w-[220px]">
                <div className="flex items-start gap-2">
                  <button type="button" aria-label={`${expandedMedicineId === m.id ? "Hide" : "Show"} batches for ${m.name}`} onClick={() => setExpandedMedicineId((current) => current === m.id ? null : m.id)} className="mt-0.5 text-[var(--cp-primary)]">
                    {expandedMedicineId === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span><span className="font-medium">{m.name}</span><span className="block text-xs text-[var(--cp-ink-soft)]">{m.unitType?.toLowerCase() ?? "unit"}{m.manufacturer ? ` · ${m.manufacturer}` : ""}</span></span>
                </div>
                {expandedMedicineId === m.id && <div className="mt-3 space-y-2 border-l-2 border-[var(--cp-border)] pl-3">
                  {!m.batches.length && <p className="text-xs text-[var(--cp-ink-soft)]">No batches recorded.</p>}
                  {m.batches.map((batch) => {
                    const expired = batchIsExpired(batch)
                    return <div key={batch.id} className={`rounded-lg border p-2 text-xs ${expired ? "border-red-300 bg-red-50 text-red-800" : "border-[var(--cp-border)] bg-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">Batch {batch.batchNumber}{expired && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 uppercase">Expired</span>}</span>
                        <span className="cp-tabular">{batch.stockQuantity} units</span>
                      </div>
                      <div className="mt-1">Expiry {dateToDmy(batch.expiryDate)} · Cost {formatCurrency(Number(batch.purchasePrice))} · Sell {formatCurrency(Number(batch.sellingPrice))}{batch.supplier?.name ? ` · ${batch.supplier.name}` : ""}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => { setAdjustOperation("ADJUSTMENT"); setAdjustTarget({ medicine: m, batch }) }} className="rounded border border-current px-2 py-1 font-semibold">Adjust</button>
                        <button type="button" onClick={() => { setAdjustOperation("DAMAGED"); setAdjustTarget({ medicine: m, batch }) }} className="rounded border border-current px-2 py-1 font-semibold">Write off damaged</button>
                        {expired && batch.stockQuantity > 0 && <button type="button" onClick={() => { setAdjustOperation("EXPIRED"); setAdjustTarget({ medicine: m, batch }) }} className="rounded border border-red-500 px-2 py-1 font-semibold text-red-700">Expire / Write-off</button>}
                      </div>
                    </div>
                  })}
                </div>}
              </div>, sortValue: (m) => m.name.toLocaleLowerCase() },
              { key: "generic", header: "Generic", render: (m) => m.genericName, hideOnMobile: true },
              { key: "category", header: "Category", render: (m) => m.category?.name ?? "—", hideOnMobile: true },
              { key: "strength", header: "Strength", render: (m) => m.strength, hideOnMobile: true },
              { key: "stock", header: "Stock", render: (m) => <span className="cp-tabular font-semibold">{m.currentStock}</span>, sortValue: (m) => m.currentStock },
              { key: "price", header: "Price", render: (m) => <span className="cp-tabular">{formatCurrency(m.sellingPrice)}</span>, hideOnMobile: true },
              { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
              {
                key: "actions", header: "Actions", render: (m) => (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); setStockInTarget(m) }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]">Stock In</button>
                    <button onClick={(e) => { e.stopPropagation(); setEditTarget(m) }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]">Edit</button>
                    <button onClick={async (e) => {
                      e.stopPropagation()
                      if (!window.confirm(`Archive ${m.name}? Medicines with stock movement history cannot be archived.`)) return
                      try { await api.archiveMedicine(m.id); await loadPharmacy(); toast({ title: "Medicine archived", description: `${m.name} has been archived.`, variant: "success" }) }
                      catch (caught) { toast({ title: "Unable to archive medicine", description: caught instanceof Error ? caught.message : "Medicine archive failed", variant: "error" }) }
                    }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"><Archive className="mr-1 inline h-3 w-3" />Archive</button>
                  </div>
                ),
              },
            ]}
            pageSize={20}
          />
        </>
      )}

      {tab === "Movement History" && (
        <DataTable
          rows={stockMovements}
          getRowKey={(m) => m.id}
          emptyIcon={History}
          columns={[
            { key: "medicine", header: "Medicine", render: (m) => m.medicineName },
            { key: "batch", header: "Batch", render: (m) => m.batchNumber, hideOnMobile: true },
            { key: "type", header: "Type", render: (m) => <StatusBadge status={m.type} tone={m.type === "Dispense" ? "warning" : "success"} /> },
            { key: "qty", header: "Qty", render: (m) => <span className={`cp-tabular font-semibold ${m.quantity < 0 ? "text-[var(--cp-critical)]" : "text-[var(--cp-success)]"}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
            { key: "invoice", header: "Invoice no.", render: (m) => m.invoiceNumber ?? "—", hideOnMobile: true },
            { key: "patient", header: "Patient", render: (m) => m.patientName ?? "—", hideOnMobile: true },
            { key: "supplierInvoice", header: "Supplier invoice", render: (m) => m.invoiceReference ?? "—", hideOnMobile: true },
            { key: "reason", header: "Reason", render: (m) => m.reason ?? "—", hideOnMobile: true },
            { key: "date", header: "Date", render: (m) => formatDateTime(m.date) },
            { key: "staff", header: "Staff", render: (m) => m.staff, hideOnMobile: true },
          ]}
        />
      )}

      {tab === "Prescriptions" && (
        <><div className="flex items-center justify-end gap-2 text-xs text-[var(--cp-ink-soft)]"><label>Print format<select value={printLayout} onChange={(event) => setPrintLayout(event.target.value as PrintLayout)} className="ml-2 rounded border border-[var(--cp-border)] bg-white px-2 py-1"><option value="a4">A4</option><option value="receipt">80mm receipt</option></select></label></div><DataTable
          rows={prescriptions.filter((prescription) => prescription.status === "SIGNED" || prescription.status === "DISPENSED")}
          getRowKey={(prescription) => prescription.id}
          emptyIcon={FileText}
          emptyTitle="No active prescriptions"
          columns={[
            { key: "date", header: "Created", render: (prescription) => formatDateTime(prescription.createdAt) },
            { key: "patient", header: "Patient", render: (prescription) => <span>{prescription.patient ? `${prescription.patient.firstName} ${prescription.patient.lastName}` : "—"}<span className="block text-xs text-[var(--cp-ink-soft)]">MR {prescription.patient?.mrNumber ?? "—"}</span></span> },
            { key: "doctor", header: "Doctor", render: (prescription) => prescription.doctor?.user.name ?? "—", hideOnMobile: true },
            { key: "items", header: "Medicines", hideOnMobile: true, render: (prescription) => <span className="flex flex-col gap-1">{prescription.items.map((item) => <span key={item.id} className="flex flex-wrap items-center gap-1"><span className="font-medium">{item.medicineName}</span><span className="text-xs text-[var(--cp-ink-soft)]">{item.doseAmount != null ? `${item.doseAmount} ${item.doseUnit ?? ""}` : item.dosage} · {item.frequencyCode ?? item.frequency} · {item.durationValue ?? item.durationDays} {item.durationUnit ?? "days"}</span>{item.requiresPharmacistReview && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Pharmacist review</span>}</span>)}</span> },
            { key: "status", header: "Status", render: (prescription) => <StatusBadge status={prescription.status} tone="success" /> },
            { key: "actions", header: "Actions", render: (prescription) => <div className="flex gap-2"><Button size="sm" disabled={prescription.status !== "SIGNED"} onClick={() => setPrescriptionToDispense(prescription)}>Dispense</Button><Button variant="outline" size="sm" onClick={async () => { setPrescriptionToPrint(await api.printPrescription(prescription.id)) }}><Printer className="h-4 w-4" /> Print</Button></div> },
          ]}
        />{prescriptionToPrint && <PrescriptionPrintDocument prescription={prescriptionToPrint} layout={printLayout} />}</>
      )}

      <AddMedicineModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={loadPharmacy} />
      <AddMedicineModal open={editTarget !== null} medicine={editTarget} onClose={() => setEditTarget(null)} onSaved={loadPharmacy} />
      <SaleModal open={saleOpen} medicines={medicines} onClose={() => setSaleOpen(false)} onSaved={loadPharmacy} />
      <StockInModal medicine={stockInTarget} onClose={() => setStockInTarget(null)} onSaved={loadPharmacy} />
      <DispensePrescriptionModal prescription={prescriptionToDispense} medicines={medicines} onClose={() => setPrescriptionToDispense(null)} onSaved={loadPharmacy} />
      <AdjustModal target={adjustTarget} initialOperation={adjustOperation} onClose={() => setAdjustTarget(null)} onSaved={loadPharmacy} />
    </div>
  )
}
