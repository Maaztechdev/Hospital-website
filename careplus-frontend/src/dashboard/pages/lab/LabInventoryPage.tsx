import * as React from "react"
import { Download, PackagePlus, Plus, RefreshCw, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal } from "@/dashboard/components/Primitives"
import { formatDate } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiLabInventoryItem, type ApiLabInventoryMovement, type ApiLabInventoryOverview, type ApiLabTest } from "@/lib/api"

const EMPTY_OVERVIEW: ApiLabInventoryOverview = { items: [], suppliers: [], counts: { lowStock: 0, expiringWithin30Days: 0, expiredBatches: 0 } }
type Dialog = "item" | "batch" | "mapping" | "adjustment" | null

export default function LabInventoryPage() {
  const { toast } = useToast()
  const [overview, setOverview] = React.useState(EMPTY_OVERVIEW)
  const [movements, setMovements] = React.useState<ApiLabInventoryMovement[]>([])
  const [tests, setTests] = React.useState<ApiLabTest[]>([])
  const [search, setSearch] = React.useState("")
  const [sort, setSort] = React.useState<"name" | "low_stock" | "expiry">("name")
  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [selectedItem, setSelectedItem] = React.useState<ApiLabInventoryItem | null>(null)
  const [selectedBatch, setSelectedBatch] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [itemForm, setItemForm] = React.useState({ name: "", category: "REAGENT" as const, unit: "", reorderLevel: "0", supplierId: "" })
  const [batchForm, setBatchForm] = React.useState({ batchNumber: "", expiryDate: "", quantity: "", purchasePrice: "", supplierId: "" })
  const [mappingForm, setMappingForm] = React.useState({ testId: "", itemId: "", quantityPerTestRun: "" })
  const [adjustForm, setAdjustForm] = React.useState({ quantity: "", reason: "" })

  const refresh = React.useCallback(async () => {
    const [inventory, ledger] = await Promise.all([
      api.getLabInventory(search, sort),
      api.listLabInventoryMovements(),
    ])
    setOverview(inventory)
    setMovements(ledger)
  }, [search, sort])

  React.useEffect(() => {
    let active = true
    Promise.all([api.getLabInventory(), api.listLabInventoryMovements(), api.listLabTests()])
      .then(([inventory, ledger, catalog]) => {
        if (!active) return
        setOverview(inventory)
        setMovements(ledger)
        setTests(catalog)
      })
      .catch((error: unknown) => toast({ title: "Unable to load Lab inventory", description: error instanceof Error ? error.message : "Please try again.", variant: "error" }))
    return () => { active = false }
  }, [toast])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh().catch((error: unknown) => toast({ title: "Unable to refresh Lab inventory", description: error instanceof Error ? error.message : "Please try again.", variant: "error" }))
    }, 200)
    return () => window.clearTimeout(timeout)
  }, [refresh, toast])

  async function exportPdf() {
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ format: "a4", unit: "mm" })
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(16)
      pdf.text("Lab Inventory", 14, 18)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      let y = 27
      pdf.text("Item | Category | Unit | Available | Reorder level | Next expiry | Supplier", 14, y)
      y += 6
      for (const item of overview.items) {
        const expiry = item.batches.find((batch) => Number(batch.quantity) > 0)?.expiryDate
        const line = `${item.name} | ${item.category} | ${item.unit} | ${item.totalQuantity} | ${item.reorderLevel} | ${expiry ? formatDate(expiry) : "—"} | ${item.supplier?.name ?? "—"}`
        const lines = pdf.splitTextToSize(line, 180) as string[]
        if (y + lines.length * 4 > 280) { pdf.addPage(); y = 18 }
        pdf.text(lines, 14, y)
        y += lines.length * 4 + 2
      }
      pdf.save("lab-inventory.pdf")
    } catch (error) {
      toast({ title: "Unable to export Lab inventory", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      if (dialog === "item") {
        await api.createLabInventoryItem({ ...itemForm, reorderLevel: Number(itemForm.reorderLevel), supplierId: itemForm.supplierId || null })
      } else if (dialog === "batch" && selectedItem) {
        await api.addLabInventoryBatch({
          itemId: selectedItem.id, batchNumber: batchForm.batchNumber.trim(), expiryDate: batchForm.expiryDate,
          quantity: Number(batchForm.quantity), purchasePrice: Number(batchForm.purchasePrice), supplierId: batchForm.supplierId || null,
        })
      } else if (dialog === "mapping") {
        await api.saveLabInventoryMapping({ ...mappingForm, quantityPerTestRun: Number(mappingForm.quantityPerTestRun) })
      } else if (dialog === "adjustment" && selectedBatch) {
        await api.adjustLabInventory({ batchId: selectedBatch, quantity: Number(adjustForm.quantity), reason: adjustForm.reason.trim() })
      }
      setDialog(null)
      await refresh()
      toast({ title: "Lab inventory updated" })
    } catch (error) {
      toast({ title: "Unable to save inventory change", description: error instanceof Error ? error.message : "Please review the values and try again.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  function openItem(item: ApiLabInventoryItem) {
    setSelectedItem(item)
    setBatchForm({ batchNumber: "", expiryDate: "", quantity: "", purchasePrice: "", supplierId: item.supplierId ?? "" })
    setDialog("batch")
  }

  return <div className="space-y-5">
    <DashboardPageHeader title="Lab Inventory" action={<><Button variant="outline" size="sm" onClick={() => void exportPdf()}><Download className="h-4 w-4" />Export PDF</Button><Button variant="outline" size="sm" onClick={() => setDialog("mapping")}><SlidersHorizontal className="h-4 w-4" />Map tests</Button><Button size="sm" onClick={() => setDialog("item")}><Plus className="h-4 w-4" />Add item</Button></>} />
    <div className="grid gap-3 sm:grid-cols-3">
      <CountCard label="Low stock" value={overview.counts.lowStock} />
      <CountCard label="Expiring within 30 days" value={overview.counts.expiringWithin30Days} />
      <CountCard label="Expired batches" value={overview.counts.expiredBatches} />
    </div>
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Stock items</CardTitle><Button variant="ghost" size="sm" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Refresh</Button></CardHeader><CardContent>
      <div className="mb-4 flex flex-wrap gap-3"><Input className="max-w-sm" placeholder="Search inventory..." value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Sort inventory" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-10 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm"><option value="name">Sort by name</option><option value="low_stock">Sort by low stock</option><option value="expiry">Sort by expiry</option></select></div>
      <div className="space-y-3">{overview.items.map((item) => <div key={item.id} className="rounded-xl border border-[var(--cp-border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-[var(--cp-ink)]">{item.name}</h3><p className="text-xs text-[var(--cp-ink-soft)]">{item.category} · {item.totalQuantity} {item.unit} available · reorder at {item.reorderLevel} · {item.supplier?.name ?? "No supplier"}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openItem(item)}><PackagePlus className="h-4 w-4" />Receive batch</Button><Button variant="outline" size="sm" onClick={() => { setSelectedItem(item); setMappingForm({ testId: "", itemId: item.id, quantityPerTestRun: "" }); setDialog("mapping") }}>Map test</Button></div></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{item.batches.map((batch) => <div key={batch.id} className="flex items-center justify-between rounded-lg bg-[var(--cp-bg)] px-3 py-2 text-xs"><span>{batch.batchNumber} · expires {formatDate(batch.expiryDate)} · {batch.quantity} {item.unit}</span><Button size="sm" variant="ghost" onClick={() => { setSelectedBatch(batch.id); setAdjustForm({ quantity: "", reason: "" }); setDialog("adjustment") }}>Adjust</Button></div>)}</div>
        <div className="mt-2 flex flex-wrap gap-2">{item.mappings.map((mapping) => <span key={mapping.id} className="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-800">{mapping.test?.testName}: {mapping.quantityPerTestRun} {item.unit}/run <button className="ml-1 font-bold" aria-label={`Remove mapping for ${mapping.test?.testName}`} onClick={() => void api.deleteLabInventoryMapping(mapping.id).then(refresh).catch((error: unknown) => toast({ title: "Unable to remove mapping", description: error instanceof Error ? error.message : "Please try again.", variant: "error" }))}>×</button></span>)}</div>
      </div>)}{!overview.items.length && <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">No inventory items found.</p>}</div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Stock adjustment and consumption history</CardTitle></CardHeader><CardContent><div className="max-h-80 space-y-2 overflow-auto">{movements.map((movement) => <div key={movement.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--cp-border)] pb-2 text-sm"><span>{movement.batch.item.name} · {movement.movementType} {movement.quantity} {movement.batch.item.unit}</span><span className="text-xs text-[var(--cp-ink-soft)]">{movement.reason ?? movement.referenceType ?? "—"} · {movement.creator.name} · {formatDate(movement.createdAt)}</span></div>)}{!movements.length && <p className="text-sm text-[var(--cp-ink-soft)]">No stock movements recorded.</p>}</div></CardContent></Card>

    <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === "item" ? "Add inventory item" : dialog === "batch" ? `Receive batch${selectedItem ? ` — ${selectedItem.name}` : ""}` : dialog === "mapping" ? "Map inventory to test" : "Adjust stock"}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {dialog === "item" && <><Field label="Item name"><Input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></Field><Field label="Category"><select className="h-10 w-full rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm" value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value as typeof itemForm.category })}>{["REAGENT", "TUBE", "STRIP", "KIT", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Unit"><Input required placeholder="mL, test, box..." value={itemForm.unit} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })} /></Field><Field label="Reorder level"><Input required type="number" min="0" step="0.001" value={itemForm.reorderLevel} onChange={(event) => setItemForm({ ...itemForm, reorderLevel: event.target.value })} /></Field><Field label="Supplier"><SupplierSelect suppliers={overview.suppliers} value={itemForm.supplierId} onChange={(supplierId) => setItemForm({ ...itemForm, supplierId })} /></Field></>}
        {dialog === "batch" && <><Field label="Batch number"><Input required value={batchForm.batchNumber} onChange={(event) => setBatchForm({ ...batchForm, batchNumber: event.target.value })} /></Field><Field label="Expiry date"><Input required type="date" min={new Date().toISOString().slice(0, 10)} value={batchForm.expiryDate} onChange={(event) => setBatchForm({ ...batchForm, expiryDate: event.target.value })} /></Field><Field label="Quantity"><Input required type="number" min="0.001" step="0.001" value={batchForm.quantity} onChange={(event) => setBatchForm({ ...batchForm, quantity: event.target.value })} /></Field><Field label="Purchase price"><Input required type="number" min="0" step="0.01" value={batchForm.purchasePrice} onChange={(event) => setBatchForm({ ...batchForm, purchasePrice: event.target.value })} /></Field><Field label="Supplier"><SupplierSelect suppliers={overview.suppliers} value={batchForm.supplierId} onChange={(supplierId) => setBatchForm({ ...batchForm, supplierId })} /></Field></>}
        {dialog === "mapping" && <><Field label="Test"><select required className="h-10 w-full rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm" value={mappingForm.testId} onChange={(event) => setMappingForm({ ...mappingForm, testId: event.target.value })}><option value="">Select test</option>{tests.map((test) => <option key={test.id} value={test.id}>{test.testName}</option>)}</select></Field><Field label="Inventory item"><select required className="h-10 w-full rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm" value={mappingForm.itemId} onChange={(event) => setMappingForm({ ...mappingForm, itemId: event.target.value })}><option value="">Select item</option>{overview.items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></Field><Field label="Quantity per test run"><Input required type="number" min="0.001" step="0.001" value={mappingForm.quantityPerTestRun} onChange={(event) => setMappingForm({ ...mappingForm, quantityPerTestRun: event.target.value })} /></Field></>}
        {dialog === "adjustment" && <><Field label="Adjustment (positive to add, negative to remove)"><Input required type="number" step="0.001" value={adjustForm.quantity} onChange={(event) => setAdjustForm({ ...adjustForm, quantity: event.target.value })} /></Field><Field label="Reason"><Input required minLength={1} value={adjustForm.reason} onChange={(event) => setAdjustForm({ ...adjustForm, reason: event.target.value })} /></Field></>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
      </form>
    </Modal>
  </div>
}

function CountCard({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-4"><p className="text-sm text-[var(--cp-ink-soft)]">{label}</p><p className="mt-1 text-2xl font-bold text-[var(--cp-ink)]">{value}</p></CardContent></Card>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>
}

function SupplierSelect({ suppliers, value, onChange }: { suppliers: Array<{ id: string; name: string }>; value: string; onChange: (value: string) => void }) {
  return <select className="h-10 w-full rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">No supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
}
