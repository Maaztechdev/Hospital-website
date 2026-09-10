import * as React from "react"
import { Pill, Package, AlertTriangle, Clock3, Wallet, Plus, History, RotateCcw, Send, Printer, FileText, ShoppingCart, X } from "lucide-react"
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
import { api, type ApiMedicine, type ApiPharmacySale, type ApiPrescription, type ApiStockMovement } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

type PharmacyMedicine = ApiMedicine & { currentStock: number; reorderLevel: number; sellingPrice: number; status: "In Stock" | "Low Stock" | "Out of Stock" | "Near Expiry"; batchNumber: string; expiryDate: string }

function toMedicine(medicine: ApiMedicine): PharmacyMedicine {
  const batches = medicine.batches
  const currentStock = batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
  const earliest = batches[0]
  const reorderLevel = batches.reduce((sum, batch) => sum + batch.reorderLevel, 0)
  const sellingPrice = Number(earliest?.sellingPrice ?? 0)
  const expiryDate = earliest?.expiryDate ?? new Date().toISOString()
  const daysToExpiry = (new Date(expiryDate).getTime() - Date.now()) / 86400000
  const status = currentStock <= 0 ? "Out of Stock" : daysToExpiry <= 30 ? "Near Expiry" : currentStock <= reorderLevel ? "Low Stock" : "In Stock"
  return { ...medicine, currentStock, reorderLevel, sellingPrice, expiryDate, batchNumber: earliest?.batchNumber ?? "—", status }
}

function toMovement(movement: ApiStockMovement) {
  const type = movement.movementType === "IN" ? "Stock In" : movement.movementType === "OUT" ? "Dispense" : movement.movementType === "RETURN" ? "Return" : "Adjustment"
  return { id: movement.id, medicineId: movement.batch.medicineId, medicineName: movement.batch.medicine.name, type, quantity: type === "Dispense" ? -movement.quantity : movement.quantity, reason: movement.reason ?? undefined, date: movement.createdAt, staff: movement.createdByUser?.name ?? "Pharmacy" } as const
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
  const selected = medicines.find((medicine) => medicine.id === medicineId)
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0)
  const total = subtotal + (Number(tax) || 0)

  React.useEffect(() => { if (open) { setCart([]); setSale(null); setMedicineId(""); setQuantity("1"); setTax("0"); setCustomerName(""); setCustomerPhone("") } }, [open])
  if (!open) return null
  if (sale) return <Modal open onClose={onClose} title={`Invoice ${sale.invoice.invoiceNumber}`}><div id="pharmacy-sale-invoice" className="space-y-3 text-sm"><p className="text-[var(--cp-ink-soft)]">Pharmacy sale recorded successfully.</p>{sale.items.map((item) => <div key={item.id} className="flex justify-between border-b border-[var(--cp-border)] pb-2"><span>{item.medicine.name} x{item.quantity} <small className="text-[var(--cp-ink-soft)]">({item.batch.batchNumber})</small></span><span className="cp-tabular">{formatCurrency(Number(item.subtotal))}</span></div>)}<div className="flex justify-between pt-2 font-semibold"><span>Total</span><span className="cp-tabular">{formatCurrency(Number(sale.totalAmount))}</span></div></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Done</Button><Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print Invoice</Button></div></Modal>
  return <Modal open onClose={onClose} title="New Pharmacy Sale" size="lg">
    <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <div className="space-y-3"><Label>Medicine</Label><select value={medicineId} onChange={(event) => setMedicineId(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="">Select medicine...</option>{medicines.filter((medicine) => medicine.currentStock > 0).map((medicine) => <option key={medicine.id} value={medicine.id}>{medicine.name} | {medicine.currentStock} in stock | expires {formatDate(medicine.expiryDate)}</option>)}</select>{selected && <p className="text-xs text-[var(--cp-ink-soft)]">FEFO will use {selected.batchNumber} first, expiry {formatDate(selected.expiryDate)}. Available: {selected.currentStock}.</p>}<div className="flex gap-2"><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><Button type="button" size="sm" disabled={!selected} onClick={() => { const n = Number(quantity); if (!selected || !n || n < 1) return; setCart((items) => { const existing = items.find((item) => item.medicineId === selected.id); return existing ? items.map((item) => item.medicineId === selected.id ? { ...item, quantity: item.quantity + n } : item) : [...items, { medicineId: selected.id, quantity: n, unitPrice: selected.sellingPrice, discount: 0 } ] }); setMedicineId(""); setQuantity("1") }}><ShoppingCart className="h-4 w-4" /> Add</Button></div></div>
      <div className="space-y-3"><Label>Customer (optional)</Label><Input placeholder="Walk-in customer name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><Input placeholder="Phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /><Label>Payment method</Label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option></select><Label>Tax</Label><Input type="number" min="0" value={tax} onChange={(event) => setTax(event.target.value)} /></div>
    </div>
    <div className="mt-5 space-y-2 border-t border-[var(--cp-border)] pt-4"><Label>Cart</Label>{cart.length === 0 && <p className="text-sm text-[var(--cp-ink-soft)]">Add one or more medicines.</p>}{cart.map((item) => { const medicine = medicines.find((candidate) => candidate.id === item.medicineId); return <div key={item.medicineId} className="flex items-center justify-between gap-2 text-sm"><span>{medicine?.name} x{item.quantity}</span><span className="cp-tabular">{formatCurrency(item.quantity * item.unitPrice - item.discount)} <button type="button" aria-label="Remove item" onClick={() => setCart((items) => items.filter((candidate) => candidate.medicineId !== item.medicineId))}><X className="inline h-4 w-4" /></button></span></div>})}<div className="flex justify-between border-t border-[var(--cp-border)] pt-2 font-semibold"><span>Total</span><span className="cp-tabular">{formatCurrency(total)}</span></div></div>
    <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={saving || cart.length === 0} onClick={async () => { setSaving(true); try { const created = await api.createPharmacySale({ items: cart, tax: Number(tax) || 0, paymentMethod, customerName: customerName.trim() || undefined, customerPhone: customerPhone.trim() || undefined }); await onSaved(); setSale(created); toast({ title: "Sale recorded", description: `Invoice ${created.invoice.invoiceNumber} generated.`, variant: "success" }) } catch (caught) { toast({ title: "Sale failed", description: caught instanceof Error ? caught.message : "Unable to record sale", variant: "error" }) } finally { setSaving(false) } }}>{saving ? "Processing..." : "Complete Sale"}</Button></div>
  </Modal>
}

function AddMedicineModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({ name: "", genericName: "", strength: "", batchNumber: "", expiryDate: "", currentStock: "", reorderLevel: "", sellingPrice: "" })
  return (
    <Modal open={open} onClose={onClose} title="Add Medicine">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div><Label>Generic Name</Label><Input value={form.genericName} onChange={(e) => setForm((f) => ({ ...f, genericName: e.target.value }))} /></div>
        <div><Label>Strength</Label><Input value={form.strength} onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))} placeholder="500mg" /></div>
        <div><Label>Batch Number</Label><Input value={form.batchNumber} onChange={(e) => setForm((f) => ({ ...f, batchNumber: e.target.value }))} /></div>
        <div><Label>Expiry Date</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} /></div>
        <div><Label>Opening Stock</Label><Input type="number" className="cp-tabular" value={form.currentStock} onChange={(e) => setForm((f) => ({ ...f, currentStock: e.target.value }))} /></div>
        <div><Label>Reorder Level</Label><Input type="number" className="cp-tabular" value={form.reorderLevel} onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))} /></div>
        <div><Label>Selling Price (PKR)</Label><Input type="number" className="cp-tabular" value={form.sellingPrice} onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={async () => {
            if (!form.name.trim()) { toast({ title: "Name required", variant: "error" }); return }
            setSaving(true); setError(null)
            try {
              const medicine = await api.createMedicine({ name: form.name.trim(), genericName: form.genericName.trim() || undefined, strength: form.strength.trim() || undefined })
              if (form.batchNumber.trim()) await api.addMedicineBatch({ medicineId: medicine.id, batchNumber: form.batchNumber.trim(), expiryDate: form.expiryDate, purchasePrice: Number(form.sellingPrice) || 0, sellingPrice: Number(form.sellingPrice) || 0, stockQuantity: Number(form.currentStock) || 0, reorderLevel: Number(form.reorderLevel) || 0 })
              await onSaved(); toast({ title: "Medicine added", description: `${form.name} added to inventory.`, variant: "success" }); onClose()
            } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to add medicine"; setError(message); toast({ title: "Unable to add medicine", description: message, variant: "error" })
            } finally { setSaving(false) }
          }}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Medicine"}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function StockInModal({ medicine, onClose, onSaved }: { medicine: PharmacyMedicine | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [qty, setQty] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => setQty(""), [medicine])
  if (!medicine) return null
  return (
    <Modal open={!!medicine} onClose={onClose} title={`Stock In — ${medicine.name}`} size="sm">
      <Label>Quantity to add</Label>
      <Input type="number" className="cp-tabular" value={qty} onChange={(e) => setQty(e.target.value)} />
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={async () => {
          const n = Number(qty)
          if (!n || n <= 0) { toast({ title: "Enter a valid quantity", variant: "error" }); return }
          const batch = medicine.batches.find((candidate) => candidate.isActive) ?? medicine.batches[0]
          if (!batch) { setError("This medicine has no active batch."); return }
          setSaving(true); setError(null)
          try { await api.stockIn({ batchId: batch.id, quantity: n }); await onSaved(); toast({ title: "Stock updated", description: `${n} units added to ${medicine.name}.`, variant: "success" }); onClose() }
          catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to update stock"; setError(message); toast({ title: "Stock update failed", description: message, variant: "error" }) }
          finally { setSaving(false) }
        }}>{saving ? "Updating…" : "Confirm Stock In"}</Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function DispenseModal({ medicine, prescriptions, onClose, onSaved }: { medicine: PharmacyMedicine | null; prescriptions: ApiPrescription[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [qty, setQty] = React.useState("")
  const [rxId, setRxId] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setQty(""); setRxId("") }, [medicine])
  if (!medicine) return null

  const signedRx = prescriptions.filter((prescription) => prescription.status === "SIGNED" && prescription.items.some((item) => item.medicineId === medicine.id || item.medicineName.toLowerCase().includes(medicine.name.toLowerCase())))
  const selected = signedRx.flatMap((prescription) => prescription.items.map((item) => ({ prescription, item }))).find(({ prescription }) => prescription.id === rxId)

  return (
    <Modal open={!!medicine} onClose={onClose} title={`Dispense — ${medicine.name}`} size="sm">
      <Label>Signed Prescription</Label>
      <select
        value={rxId}
        onChange={(e) => setRxId(e.target.value)}
        className="mb-1 h-11 w-full rounded-xl border border-[var(--cp-border)] bg-white px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-accent)]"
      >
        <option value="">Select a prescription…</option>
        {signedRx.map((prescription) => <option key={prescription.id} value={prescription.id}>{formatDate(prescription.createdAt)} ({prescription.items.length} item(s))</option>)}
      </select>
      {signedRx.length === 0 && <p className="mb-2 text-xs text-[var(--cp-ink-soft)]">No signed prescription item is available for this medicine.</p>}
      <Label>Quantity</Label>
      <Input type="number" className="cp-tabular" value={qty} onChange={(e) => setQty(e.target.value)} />
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={saving || !selected}
          onClick={async () => {
            const n = Number(qty)
            if (!n || n <= 0) { toast({ title: "Enter a valid quantity", variant: "error" }); return }
            if (!selected) { toast({ title: "Select a signed prescription", variant: "error" }); return }
            setSaving(true); setError(null)
            try { await api.dispense({ prescriptionItemId: selected.item.id, quantity: n }); await onSaved(); toast({ title: "Medicine dispensed", description: `${n} units of ${medicine.name} dispensed using FEFO.`, variant: "success" }); onClose() }
            catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to dispense medicine"; setError(message); toast({ title: "Dispense failed", description: message, variant: "error" }) }
            finally { setSaving(false) }
          }}
        >
          {saving ? "Dispensing…" : "Confirm Dispense"}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    </Modal>
  )
}

function AdjustModal({ medicine, onClose, onSaved }: { medicine: PharmacyMedicine | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [qty, setQty] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [operation, setOperation] = React.useState<"RETURN" | "ADJUSTMENT" | "DAMAGED" | "EXPIRED">("ADJUSTMENT")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setQty(""); setReason("") }, [medicine])
  if (!medicine) return null
  return (
    <Modal open={!!medicine} onClose={onClose} title={`Return / Adjust — ${medicine.name}`} size="sm">
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
            const batch = medicine.batches.find((candidate) => candidate.isActive) ?? medicine.batches[0]
            if (!batch) { setError("This medicine has no active batch."); return }
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

export default function PharmacyDashboard() {
  const [medicines, setMedicines] = React.useState<PharmacyMedicine[]>([])
  const [stockMovements, setStockMovements] = React.useState<ReturnType<typeof toMovement>[]>([])
  const [prescriptions, setPrescriptions] = React.useState<ApiPrescription[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState("Inventory")
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [addOpen, setAddOpen] = React.useState(false)
  const [stockInTarget, setStockInTarget] = React.useState<PharmacyMedicine | null>(null)
  const [dispenseTarget, setDispenseTarget] = React.useState<PharmacyMedicine | null>(null)
  const [adjustTarget, setAdjustTarget] = React.useState<PharmacyMedicine | null>(null)
  const [saleOpen, setSaleOpen] = React.useState(false)

  const loadPharmacy = React.useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [medicineResponse, movementResponse, prescriptionResponse] = await Promise.all([api.listMedicines(search), api.listStockMovements(), api.listPrescriptions("SIGNED")])
      setMedicines(medicineResponse.map(toMedicine)); setStockMovements(movementResponse.map(toMovement)); setPrescriptions(prescriptionResponse)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load pharmacy data") }
    finally { setLoading(false) }
  }, [search])

  React.useEffect(() => { void loadPharmacy() }, [loadPharmacy])

  const todaysRx = prescriptions.filter((prescription) => new Date(prescription.createdAt).toDateString() === new Date().toDateString())
  const dispensedCount = stockMovements.filter((m) => m.type === "Dispense").length
  const lowStock = medicines.filter((m) => m.status === "Low Stock" || m.status === "Out of Stock").length
  const nearExpiry = medicines.filter((m) => m.status === "Near Expiry").length
  const inventoryValue = medicines.reduce((s, m) => s + m.currentStock * m.sellingPrice, 0)

  const filtered = medicines.filter((m) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || m.name.toLowerCase().includes(q) || (m.genericName ?? "").toLowerCase().includes(q)
    const matchesStatus = statusFilter === "all" || m.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Pharmacy"
        action={<div className="flex gap-2"><Button size="sm" onClick={() => setSaleOpen(true)}><ShoppingCart className="h-4 w-4" /> New Sale</Button><Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Medicine</Button></div>}
      />

      {loading && <p className="text-sm text-[var(--cp-ink-soft)]">Loading pharmacy data…</p>}
      {error && <div className="flex items-center justify-between rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadPharmacy()}>Retry</Button></div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Today's Prescriptions" value={todaysRx.length.toString()} icon={Pill} tone="primary" />
        <StatCard label="Medicines Dispensed" value={dispensedCount.toString()} icon={Send} tone="success" />
        <StatCard label="Low Stock" value={lowStock.toString()} icon={AlertTriangle} tone="warning" />
        <StatCard label="Near Expiry" value={nearExpiry.toString()} icon={Clock3} tone="warning" />
        <StatCard label="Inventory Value" value={formatCurrency(inventoryValue)} icon={Wallet} tone="primary" />
      </div>

      <Tabs tabs={["Inventory", "Prescriptions", "Movement History"]} active={tab} onChange={setTab} />

      {tab === "Inventory" && (
        <>
          <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search medicine or generic name…">
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "All statuses" }, { value: "In Stock", label: "In Stock" }, { value: "Low Stock", label: "Low Stock" }, { value: "Out of Stock", label: "Out of Stock" }, { value: "Near Expiry", label: "Near Expiry" }]} />
          </FilterBar>

          <DataTable
            rows={filtered}
            getRowKey={(m) => m.id}
            emptyIcon={Package}
            emptyTitle="No medicines found"
            rowTone={(m) => toneFor(m.status)}
            columns={[
              { key: "name", header: "Medicine", render: (m) => <span className="font-medium">{m.name}</span> },
              { key: "generic", header: "Generic", render: (m) => m.genericName, hideOnMobile: true },
              { key: "strength", header: "Strength", render: (m) => m.strength, hideOnMobile: true },
              { key: "batch", header: "Batch", render: (m) => <span className="cp-tabular text-xs">{m.batchNumber}</span>, hideOnMobile: true },
              { key: "expiry", header: "Expiry", render: (m) => formatDate(m.expiryDate) },
              { key: "stock", header: "Stock", render: (m) => <span className="cp-tabular font-semibold">{m.currentStock}</span>, sortValue: (m) => m.currentStock },
              { key: "price", header: "Price", render: (m) => <span className="cp-tabular">{formatCurrency(m.sellingPrice)}</span>, hideOnMobile: true },
              { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
              {
                key: "actions", header: "Actions", render: (m) => (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); setDispenseTarget(m) }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]">Dispense</button>
                    <button onClick={(e) => { e.stopPropagation(); setStockInTarget(m) }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]">Stock In</button>
                    <button onClick={(e) => { e.stopPropagation(); setAdjustTarget(m) }} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-[11px] font-semibold text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]">Adjust</button>
                  </div>
                ),
              },
            ]}
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
            { key: "type", header: "Type", render: (m) => <StatusBadge status={m.type} tone={m.type === "Dispense" ? "warning" : "success"} /> },
            { key: "qty", header: "Qty", render: (m) => <span className={`cp-tabular font-semibold ${m.quantity < 0 ? "text-[var(--cp-critical)]" : "text-[var(--cp-success)]"}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
            { key: "reason", header: "Reason", render: (m) => m.reason ?? "—", hideOnMobile: true },
            { key: "date", header: "Date", render: (m) => formatDateTime(m.date) },
            { key: "staff", header: "Staff", render: (m) => m.staff, hideOnMobile: true },
          ]}
        />
      )}

      {tab === "Prescriptions" && (
        <DataTable
          rows={prescriptions}
          getRowKey={(prescription) => prescription.id}
          emptyIcon={FileText}
          emptyTitle="No signed prescriptions"
          columns={[
            { key: "date", header: "Created", render: (prescription) => formatDateTime(prescription.createdAt) },
            { key: "items", header: "Medicines", hideOnMobile: true, render: (prescription) => <span>{prescription.items.map((item) => item.medicineName).join(", ")}</span> },
            { key: "status", header: "Status", render: (prescription) => <StatusBadge status={prescription.status} tone="success" /> },
            { key: "actions", header: "Actions", render: (prescription) => <Button variant="outline" size="sm" onClick={async () => { await api.printPrescription(prescription.id); window.print() }}><Printer className="h-4 w-4" /> Print</Button> },
          ]}
        />
      )}

      <AddMedicineModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={loadPharmacy} />
      <SaleModal open={saleOpen} medicines={medicines} onClose={() => setSaleOpen(false)} onSaved={loadPharmacy} />
      <StockInModal medicine={stockInTarget} onClose={() => setStockInTarget(null)} onSaved={loadPharmacy} />
      <DispenseModal medicine={dispenseTarget} prescriptions={prescriptions} onClose={() => setDispenseTarget(null)} onSaved={loadPharmacy} />
      <AdjustModal medicine={adjustTarget} onClose={() => setAdjustTarget(null)} onSaved={loadPharmacy} />
    </div>
  )
}
