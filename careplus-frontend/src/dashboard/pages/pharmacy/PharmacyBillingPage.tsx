import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, Barcode, Minus, Plus, Printer, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal } from "@/dashboard/components/Primitives"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { api, type ApiMedicine, type ApiMedicineBatch, type ApiPatient, type ApiPharmacySale, type ApiPharmacySettings } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { InvoicePrintDocument, type PrintLayout } from "./PharmacyPrintDocuments"

type CartLine = { medicine: ApiMedicine; quantity: number; unitPrice: number }
type PaymentTab = "CASH" | "CARD" | "OTHER" | "CREDIT"

function eligibleBatches(medicine: ApiMedicine): ApiMedicineBatch[] {
  const now = Date.now()
  return medicine.batches
    .filter((batch) => batch.isActive && batch.stockQuantity > 0 && new Date(batch.expiryDate).getTime() > now)
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function lineGross(line: CartLine): number {
  let remaining = line.quantity
  return roundMoney(eligibleBatches(line.medicine).reduce((total, batch) => {
    if (remaining <= 0) return total
    const quantity = Math.min(batch.stockQuantity, remaining)
    remaining -= quantity
    return total + quantity * Number(batch.sellingPrice)
  }, 0))
}

function BillingPage() {
  const navigate = useNavigate()
  const { currentUser } = useDashboard()
  const { toast } = useToast()
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [medicines, setMedicines] = React.useState<ApiMedicine[]>([])
  const [medicineLoading, setMedicineLoading] = React.useState(false)
  const [selectedMedicine, setSelectedMedicine] = React.useState<ApiMedicine | null>(null)
  const [selectedQuantity, setSelectedQuantity] = React.useState("1")
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const [cart, setCart] = React.useState<CartLine[]>([])
  const [patientQuery, setPatientQuery] = React.useState("")
  const [debouncedPatientQuery, setDebouncedPatientQuery] = React.useState("")
  const [patientResults, setPatientResults] = React.useState<ApiPatient[]>([])
  const [patient, setPatient] = React.useState<ApiPatient | null>(null)
  const [customerName, setCustomerName] = React.useState("")
  const [customerPhone, setCustomerPhone] = React.useState("")
  const [paymentTab, setPaymentTab] = React.useState<PaymentTab>("CASH")
  const [paidNow, setPaidNow] = React.useState("0")
  const [paidNowMethod, setPaidNowMethod] = React.useState<"CASH" | "CARD" | "BANK_TRANSFER">("CASH")
  const [discountPercent, setDiscountPercent] = React.useState("0")
  const [discountReason, setDiscountReason] = React.useState("")
  const [discountLimit, setDiscountLimit] = React.useState<number | null>(null)
  const [approvalOpen, setApprovalOpen] = React.useState(false)
  const [approvalEmail, setApprovalEmail] = React.useState("")
  const [approvalPassword, setApprovalPassword] = React.useState("")
  const [approvalPin, setApprovalPin] = React.useState("")
  const [approvalMode, setApprovalMode] = React.useState<"login" | "pin">("login")
  const [approvalError, setApprovalError] = React.useState<string | null>(null)
  const [approvalToken, setApprovalToken] = React.useState<string | null>(null)
  const [pharmacySettings, setPharmacySettings] = React.useState<ApiPharmacySettings | null>(null)
  const [taxAmount, setTaxAmount] = React.useState("0")
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [sale, setSale] = React.useState<ApiPharmacySale | null>(null)
  const [printLayout, setPrintLayout] = React.useState<PrintLayout>("a4")
  const [printing, setPrinting] = React.useState(false)

  React.useEffect(() => {
    let active = true
    void api.getPharmacySettings().then((settings) => {
      const limit = Number(settings.cashierMaxDiscountPercent)
      if (!Number.isFinite(limit) || limit < 0 || limit > 100) throw new Error("The configured cashier discount limit is invalid.")
      if (active) {
        setDiscountLimit(limit)
        setPharmacySettings(settings)
        setPrintLayout(settings.defaultReceiptFormat)
        if (settings.adminPinConfigured) setApprovalMode("pin")
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load the pharmacy discount limit")
    })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    let active = true
    setMedicineLoading(true)
    void api.listMedicines(debouncedSearch).then((items) => {
      if (active) {
        setMedicines(items)
        setHighlightedIndex(0)
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to search medicines")
    }).finally(() => {
      if (active) setMedicineLoading(false)
    })
    return () => { active = false }
  }, [debouncedSearch])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPatientQuery(patientQuery.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [patientQuery])

  React.useEffect(() => {
    let active = true
    if (!debouncedPatientQuery || patient) {
      setPatientResults([])
      return () => { active = false }
    }
    void api.searchPatients(debouncedPatientQuery).then((items) => {
      if (active) setPatientResults(items)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to search patients")
    })
    return () => { active = false }
  }, [debouncedPatientQuery, patient])

  React.useEffect(() => {
    if (!sale) return
    setPrinting(true)
  }, [sale])

  React.useEffect(() => {
    if (!printing) return
    const handleAfterPrint = () => setPrinting(false)
    window.addEventListener("afterprint", handleAfterPrint, { once: true })
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("afterprint", handleAfterPrint)
    }
  }, [printing])

  const addToCart = (medicine: ApiMedicine, quantity: number) => {
    const batches = eligibleBatches(medicine)
    const available = batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
    const existing = cart.find((line) => line.medicine.id === medicine.id)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Enter a whole-number quantity greater than zero.")
      return
    }
    if (quantity + (existing?.quantity ?? 0) > available) {
      setError(`Only ${available} non-expired unit(s) are available for ${medicine.name}.`)
      return
    }
    if (!batches.length) {
      setError(`${medicine.name} has no active, non-expired stock.`)
      return
    }
    setError(null)
    setCart((lines) => {
      const line = lines.find((item) => item.medicine.id === medicine.id)
      if (line) return lines.map((item) => item.medicine.id === medicine.id ? { ...item, quantity: item.quantity + quantity } : item)
      return [...lines, { medicine, quantity, unitPrice: Number(batches[0].sellingPrice) }]
    })
    setSelectedMedicine(null)
    setSelectedQuantity("1")
    setSearch("")
  }

  const handleSearchKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(medicines.length - 1, 0)))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    const query = search.trim()
    if (!query) return
    try {
      const matches = await api.listMedicines(query)
      const exactBarcode = matches.find((medicine) => medicine.barcode?.toLowerCase() === query.toLowerCase())
      if (exactBarcode) {
        addToCart(exactBarcode, 1)
        return
      }
      const candidate = matches[highlightedIndex] ?? matches[0]
      if (candidate) setSelectedMedicine(candidate)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to find the scanned medicine")
    }
  }

  const updateQuantity = (medicineId: string, nextQuantity: number) => {
    const line = cart.find((item) => item.medicine.id === medicineId)
    if (!line) return
    const available = eligibleBatches(line.medicine).reduce((sum, batch) => sum + batch.stockQuantity, 0)
    if (nextQuantity > available) {
      setError(`Quantity cannot exceed the ${available} non-expired unit(s) in stock.`)
      return
    }
    setError(null)
    if (nextQuantity <= 0) setCart((lines) => lines.filter((item) => item.medicine.id !== medicineId))
    else setCart((lines) => lines.map((item) => item.medicine.id === medicineId ? { ...item, quantity: nextQuantity } : item))
  }

  const subtotal = roundMoney(cart.reduce((sum, line) => sum + lineGross(line), 0))
  const discount = roundMoney(subtotal * Math.min(Math.max(Number(discountPercent) || 0, 0), 100) / 100)
  const tax = roundMoney(Math.max(Number(taxAmount) || 0, 0))
  const total = roundMoney(subtotal - discount + tax)

  const completeSale = async (adminApprovalToken?: string, adminApprovalPin?: string) => {
    if (!cart.length) {
      setError("Add at least one medicine before completing the sale.")
      return
    }
    const percent = Number(discountPercent)
    const parsedTax = Number(taxAmount)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(parsedTax) || parsedTax < 0) {
      setError("Discount must be from 0 to 100%; tax must be a non-negative PKR amount.")
      return
    }
    if (discountLimit === null) {
      setError("The cashier discount limit has not loaded yet.")
      return
    }
    const paidNowAmount = Number(paidNow)
    if (paymentTab === "CREDIT") {
      if (!patient && !customerName.trim()) {
        setError("Select a Patient or enter a customer name before placing a sale on credit.")
        return
      }
      if (!Number.isFinite(paidNowAmount) || paidNowAmount < 0 || paidNowAmount >= total) {
        setError("Amount paid now must be non-negative and less than the invoice total for a credit sale.")
        return
      }
    }
    if (percent > discountLimit && !discountReason.trim()) {
      setError(`A reason is required for discounts above ${discountLimit}%.`)
      return
    }
    if (percent > discountLimit && currentUser?.role !== "admin" && !adminApprovalToken && !approvalToken && !adminApprovalPin) {
      setApprovalError(null)
      setApprovalOpen(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await api.createPharmacySale({
        items: cart.map((line) => ({
          medicineId: line.medicine.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: roundMoney(lineGross(line) * percent / 100),
        })),
        tax: parsedTax,
        paymentMethod: paymentTab === "CREDIT" ? "CREDIT" : paymentTab === "CASH" ? "CASH" : paymentTab === "CARD" ? "CARD" : "BANK_TRANSFER",
        ...(paymentTab === "CREDIT" ? { paidNow: paidNowAmount, paidNowMethod } : {}),
        patientId: patient?.id,
        customerName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : customerName.trim() || undefined,
        customerPhone: patient?.phone ?? (customerPhone.trim() || undefined),
        discountReason: discountReason.trim() || undefined,
      }, adminApprovalToken ?? approvalToken ?? undefined, adminApprovalPin)
      setSale(created)
      toast({ title: "Sale completed", description: `Invoice ${created.invoice.invoiceNumber} created and stock updated.`, variant: "success" })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to complete the sale"
      if (adminApprovalPin) {
        setApprovalError(message)
        setApprovalOpen(true)
      } else setError(message)
      toast({ title: "Sale failed", description: message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const confirmAdminApproval = async () => {
    setApprovalError(null)
    if (approvalMode === "pin") {
      if (!/^\d{4,12}$/.test(approvalPin)) {
        setApprovalError("Enter the configured 4–12 digit Admin PIN.")
        return
      }
      await completeSale(undefined, approvalPin)
      return
    }
    if (!approvalEmail.trim() || !approvalPassword) {
      setApprovalError("Enter an Admin email and password to approve this discount.")
      return
    }
    try {
      const login = await api.login(approvalEmail.trim(), approvalPassword)
      if (login.user.role !== "ADMIN") {
        setApprovalError("This login is not an Admin account.")
        return
      }
      setApprovalToken(login.accessToken)
      setApprovalOpen(false)
      setApprovalPassword("")
      await completeSale(login.accessToken)
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : "Admin login confirmation failed")
    }
  }

  if (sale) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardPageHeader title="Pharmacy Invoice" action={<Button variant="outline" size="sm" onClick={() => navigate("/dashboard/pharmacy")}><ArrowLeft className="h-4 w-4" /> Pharmacy</Button>} />
        <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Sale completed</h2>
          <p className="mt-1 text-sm text-[var(--cp-ink-soft)]">Invoice {sale.invoice.invoiceNumber} was created. The invoice print dialog has been opened.</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm">Print format
              <select value={printLayout} onChange={(event) => setPrintLayout(event.target.value as PrintLayout)} className="ml-2 h-9 rounded-lg border border-[var(--cp-border)] bg-white px-2">
                <option value="a4">A4</option><option value="receipt">80mm receipt</option>
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate(`/dashboard/pharmacy/invoices/${sale.invoice.id}`)}>Manage returns / void</Button>
              <Button variant="outline" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Print invoice</Button>
              <Button onClick={() => navigate("/dashboard/pharmacy")}>Done</Button>
            </div>
          </div>
        </section>
        {printing && <InvoicePrintDocument sale={sale} layout={printLayout} pharmacySettings={pharmacySettings} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Pharmacy Billing" action={<Button variant="outline" size="sm" onClick={() => navigate("/dashboard/pharmacy")}><ArrowLeft className="h-4 w-4" /> Back to Pharmacy</Button>} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Medicine picker</h2>
            <Barcode className="h-5 w-5 text-[var(--cp-ink-soft)]" aria-hidden="true" />
          </div>
          <Label htmlFor="pharmacy-medicine-search" className="mt-4 block">Search by medicine, generic name, or barcode</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--cp-ink-soft)]" />
            <Input
              id="pharmacy-medicine-search"
              autoFocus
              className="pl-9"
              placeholder="Type or scan barcode, then press Enter"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => void handleSearchKeyDown(event)}
              aria-controls="pharmacy-medicine-results"
            />
          </div>
          <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Keyboard: use ↑ / ↓ to choose a result and Enter; barcode scanners can send the code followed by Enter.</p>
          {medicineLoading && <p className="mt-3 text-sm text-[var(--cp-ink-soft)]">Searching medicines…</p>}
          {!medicineLoading && debouncedSearch && medicines.length === 0 && <p className="mt-3 text-sm text-[var(--cp-ink-soft)]">No medicine matches this search.</p>}
          <div id="pharmacy-medicine-results" role="listbox" aria-label="Medicine search results" className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto">
            {medicines.map((medicine, index) => {
              const batches = eligibleBatches(medicine)
              const stock = batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
              const nearest = batches[0]
              const isSelected = selectedMedicine?.id === medicine.id
              return (
                <button
                  key={medicine.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`w-full rounded-xl border p-3 text-left transition ${isSelected || index === highlightedIndex ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)]" : "border-[var(--cp-border)] hover:bg-[var(--cp-bg)]"}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => { setSelectedMedicine(medicine); setSelectedQuantity("1") }}
                >
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span><strong className="block text-sm">{medicine.name}</strong><span className="text-xs text-[var(--cp-ink-soft)]">{medicine.genericName || "Generic not listed"}{medicine.strength ? ` · ${medicine.strength}` : ""}</span></span>
                    <span className="text-right text-xs"><strong className="block">{stock} in stock</strong><span>{nearest ? formatCurrency(Number(nearest.sellingPrice)) : "Unavailable"}</span></span>
                  </span>
                  <span className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-[var(--cp-ink-soft)]">
                    <span>Barcode: {medicine.barcode || "—"}</span>
                    <span>Nearest expiry: {nearest ? formatDate(nearest.expiryDate) : "No eligible batch"}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {selectedMedicine && (() => {
            const batches = eligibleBatches(selectedMedicine)
            const available = batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
            return <div className="mt-4 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-bg)] p-3">
              <p className="text-sm font-semibold">FEFO: {batches[0]?.batchNumber ?? "No eligible batch"}{batches[0] ? ` · expires ${formatDate(batches[0].expiryDate)}` : ""}</p>
              <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">The earliest-expiring active, non-expired batch is used first. Available: {available}.</p>
              <div className="mt-3 flex gap-2">
                <Input aria-label="Quantity to add" type="number" min="1" max={available} step="1" value={selectedQuantity} onChange={(event) => setSelectedQuantity(event.target.value)} />
                <Button type="button" disabled={!available} onClick={() => addToCart(selectedMedicine, Number(selectedQuantity))}><Plus className="h-4 w-4" /> Add to invoice</Button>
              </div>
            </div>
          })()}
        </section>

        <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Current invoice</h2>
          <div className="mt-4">
            <Label htmlFor="pharmacy-customer-search">Patient (optional)</Label>
            {patient ? <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-[var(--cp-bg)] p-3 text-sm">
              <span><strong>{patient.firstName} {patient.lastName}</strong><span className="ml-2 text-xs text-[var(--cp-ink-soft)]">{patient.mrNumber} · {patient.phone}</span></span>
              <Button type="button" size="sm" variant="outline" onClick={() => { setPatient(null); setPatientQuery("") }}>Change</Button>
            </div> : <>
              <Input id="pharmacy-customer-search" className="mt-1" placeholder="Search by patient name, phone, or MR number" value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} />
              {patientResults.length > 0 && <div role="listbox" aria-label="Patient search results" className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--cp-border)] bg-white">
                {patientResults.map((item) => <button key={item.id} type="button" role="option" className="block w-full border-b border-[var(--cp-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--cp-bg)]" onClick={() => { setPatient(item); setPatientQuery(""); setPatientResults([]) }}>
                  <strong>{item.firstName} {item.lastName}</strong><span className="ml-2 text-xs text-[var(--cp-ink-soft)]">{item.phone} · {item.mrNumber}</span>
                </button>)}
              </div>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input aria-label="Walk-in customer name" placeholder="Walk-in name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
                <Input aria-label="Walk-in customer phone" placeholder="Walk-in phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
              </div>
            </>}
          </div>

          <div className="mt-4 border-t border-[var(--cp-border)] pt-3">
            <h3 className="text-sm font-semibold">Payment</h3>
            <div role="tablist" aria-label="Payment method" className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-[var(--cp-bg)] p-1">
              {(["CASH", "CARD", "OTHER", "CREDIT"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={paymentTab === tab} className={`rounded-lg px-2 py-2 text-xs font-medium ${paymentTab === tab ? "bg-white text-[var(--cp-primary)] shadow-sm" : ""}`} onClick={() => setPaymentTab(tab)}>
                {tab === "OTHER" ? "Other" : tab === "CREDIT" ? "Credit" : tab === "CASH" ? "Cash" : "Card"}
              </button>)}
            </div>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{paymentTab === "OTHER" ? "Other is recorded as bank transfer." : paymentTab === "CREDIT" ? "The unpaid balance is added to this customer's Khata." : `Payment method: ${paymentTab.toLowerCase()}.`}</p>
            {paymentTab === "CREDIT" && <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div><Label htmlFor="pharmacy-paid-now">Paid now (PKR)</Label><Input id="pharmacy-paid-now" type="number" min="0" max={Math.max(0, total - 0.01)} step="0.01" value={paidNow} onChange={(event) => setPaidNow(event.target.value)} /></div>
              <div><Label htmlFor="pharmacy-paid-method">Payment method</Label><select id="pharmacy-paid-method" className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={paidNowMethod} onChange={(event) => setPaidNowMethod(event.target.value as typeof paidNowMethod)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Other / bank transfer</option></select></div>
              <p className="text-xs text-[var(--cp-ink-soft)] sm:col-span-2">Remaining on credit: {formatCurrency(Math.max(0, total - (Number(paidNow) || 0)))}</p>
            </div>}
          </div>

          <div className="mt-4 grid gap-3 border-t border-[var(--cp-border)] pt-3 sm:grid-cols-2">
            <div><Label htmlFor="pharmacy-discount">Discount (%)</Label><Input id="pharmacy-discount" type="number" min="0" max="100" step="0.01" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Cashier limit: {discountLimit === null ? "Loading…" : `${discountLimit}%`}</p></div>
            <div><Label htmlFor="pharmacy-tax">Tax amount (PKR)</Label><Input id="pharmacy-tax" type="number" min="0" step="0.01" value={taxAmount} onChange={(event) => setTaxAmount(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="pharmacy-discount-reason">Discount reason {Number(discountPercent) > (discountLimit ?? 10) ? "(required for Admin approval)" : "(optional)"}</Label><Input id="pharmacy-discount-reason" value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} maxLength={500} placeholder="Reason for discount" /></div>
          </div>

          <div className="mt-4 max-h-[22rem] min-h-24 space-y-2 overflow-y-auto border-y border-[var(--cp-border)] py-3">
            {cart.length === 0 && <p className="text-sm text-[var(--cp-ink-soft)]">Scan or search for medicines to start this invoice.</p>}
            {cart.map((line) => {
              const batches = eligibleBatches(line.medicine)
              let remaining = line.quantity
              const fefoPlan = batches.flatMap((batch) => {
                if (remaining <= 0) return []
                const quantity = Math.min(batch.stockQuantity, remaining)
                remaining -= quantity
                return quantity > 0 ? [{ batch, quantity }] : []
              })
              return <div key={line.medicine.id} className="rounded-lg bg-[var(--cp-bg)] p-2">
                <div className="flex items-start justify-between gap-2">
                  <div><strong className="text-sm">{line.medicine.name}</strong><p className="text-xs text-[var(--cp-ink-soft)]">{fefoPlan.map(({ batch, quantity }) => `${batch.batchNumber} × ${quantity} (exp ${formatDate(batch.expiryDate)})`).join(" · ")}</p></div>
                  <button type="button" aria-label={`Remove ${line.medicine.name}`} className="rounded p-1 text-[var(--cp-critical)]" onClick={() => updateQuantity(line.medicine.id, 0)}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="outline" aria-label={`Decrease ${line.medicine.name} quantity`} onClick={() => updateQuantity(line.medicine.id, line.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                    <Input aria-label={`${line.medicine.name} quantity`} className="h-9 w-16 text-center" type="number" min="1" max={batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)} value={line.quantity} onChange={(event) => { if (/^\d+$/.test(event.target.value)) updateQuantity(line.medicine.id, Number(event.target.value)) }} />
                    <Button type="button" size="sm" variant="outline" aria-label={`Increase ${line.medicine.name} quantity`} disabled={line.quantity >= batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)} onClick={() => updateQuantity(line.medicine.id, line.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <span className="text-right text-sm font-semibold">{formatCurrency(lineGross(line))}<small className="block font-normal text-[var(--cp-ink-soft)]">FEFO batch pricing</small></span>
                </div>
              </div>
            })}
          </div>

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCurrency(subtotal)}</dd></div>
            <div className="flex justify-between"><dt>Discount ({Number(discountPercent) || 0}%)</dt><dd>−{formatCurrency(discount)}</dd></div>
            <div className="flex justify-between"><dt>Tax (PKR amount)</dt><dd>{formatCurrency(tax)}</dd></div>
            <div className="flex justify-between border-t border-[var(--cp-border)] pt-2 text-base font-bold"><dt>Total</dt><dd>{formatCurrency(total)}</dd></div>
          </dl>
          {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--cp-critical-light)] p-2 text-sm text-[var(--cp-critical)]">{error}</p>}
          <Button className="mt-4 w-full" disabled={saving || cart.length === 0 || discountLimit === null} onClick={() => void completeSale()}>{saving ? "Completing sale…" : "Complete Sale"}</Button>
          <p className="mt-2 text-center text-xs text-[var(--cp-ink-soft)]">Stock is deducted from FEFO batches only after the sale is completed.</p>
          <Link className="mt-3 block text-center text-xs text-[var(--cp-ink-soft)] underline" to="/dashboard/pharmacy/legacy-sale">Open legacy sale modal</Link>
        </section>
      </div>
      <Modal open={approvalOpen} onClose={() => { setApprovalOpen(false); setApprovalPassword(""); setApprovalPin(""); setApprovalError(null) }} title="Admin discount approval" size="sm">
        <p className="mb-4 text-sm text-[var(--cp-ink-soft)]">A discount of {Number(discountPercent) || 0}% is above the cashier limit of {discountLimit ?? 10}%. An Admin must approve it.</p>
        <div className="space-y-3">
          <div role="tablist" aria-label="Admin approval method" className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--cp-bg)] p-1">
            <button type="button" role="tab" aria-selected={approvalMode === "pin"} onClick={() => setApprovalMode("pin")} className={`rounded-md px-3 py-2 text-sm ${approvalMode === "pin" ? "bg-white font-semibold shadow-sm" : ""}`}>Admin PIN</button>
            <button type="button" role="tab" aria-selected={approvalMode === "login"} onClick={() => setApprovalMode("login")} className={`rounded-md px-3 py-2 text-sm ${approvalMode === "login" ? "bg-white font-semibold shadow-sm" : ""}`}>Admin login</button>
          </div>
          {approvalMode === "pin"
            ? <div><Label htmlFor="discount-admin-pin">Admin PIN</Label><Input id="discount-admin-pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,12}" value={approvalPin} onChange={(event) => setApprovalPin(event.target.value)} /></div>
            : <><div><Label htmlFor="discount-admin-email">Admin email</Label><Input id="discount-admin-email" type="email" autoComplete="username" value={approvalEmail} onChange={(event) => setApprovalEmail(event.target.value)} /></div><div><Label htmlFor="discount-admin-password">Admin password</Label><Input id="discount-admin-password" type="password" autoComplete="current-password" value={approvalPassword} onChange={(event) => setApprovalPassword(event.target.value)} /></div></>}
          {approvalError && <p role="alert" className="text-sm text-[var(--cp-critical)]">{approvalError}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void confirmAdminApproval()}>{saving ? "Completing…" : "Confirm and complete sale"}</Button></div>
        </div>
      </Modal>
    </div>
  )
}

export default BillingPage
