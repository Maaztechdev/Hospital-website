import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/dashboard/components/Primitives"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { api, toInvoice, toLabOrder, type ApiLabPackage, type ApiLabTest } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

const QUICK_DISCOUNT_REASONS = ["Financial hardship", "Staff concession", "Management-approved", "Other"]

export function CreateLabOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patients, currentUser, dispatch } = useDashboard()
  const { toast } = useToast()
  const [tests, setTests] = React.useState<ApiLabTest[]>([])
  const [packages, setPackages] = React.useState<ApiLabPackage[]>([])
  const [referringClinics, setReferringClinics] = React.useState<Array<{ id: string; partyName: string }>>([])
  const [discountLimit, setDiscountLimit] = React.useState<number | null>(null)
  const [patientId, setPatientId] = React.useState("")
  const [referringClinicAccountId, setReferringClinicAccountId] = React.useState("")
  const [catalogType, setCatalogType] = React.useState<"test" | "package">("test")
  const [catalogId, setCatalogId] = React.useState("")
  const [priority, setPriority] = React.useState<"ROUTINE" | "URGENT" | "EMERGENCY">("ROUTINE")
  const [discountPercent, setDiscountPercent] = React.useState("0")
  const [discountReasonChoice, setDiscountReasonChoice] = React.useState("")
  const [discountReasonText, setDiscountReasonText] = React.useState("")
  const [adminEmail, setAdminEmail] = React.useState("")
  const [adminPassword, setAdminPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setError("")
    Promise.all([api.listLabTests(), api.listLabPackages(), api.getLabOrderPolicy(), api.listLabReferringClinics()])
      .then(([testItems, packageItems, policy, clinics]) => {
        const limit = Number(policy.maxDiscountPercent)
        if (!Number.isFinite(limit) || limit < 0 || limit > 100) throw new Error("The configured cashier discount limit is invalid.")
        setTests(testItems)
        setPackages(packageItems)
        setReferringClinics(clinics)
        setDiscountLimit(limit)
        setPatientId((current) => current || patients.find((item) => item.id)?.id || "")
        setCatalogId((current) => current || testItems[0]?.id || "")
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load Lab ordering options."))
      .finally(() => setLoading(false))
  }, [open, patients])

  const availableCatalog = catalogType === "test"
    ? tests.map((item) => ({ id: item.id, label: `${item.testName} · PKR ${Number(item.price).toLocaleString()}` }))
    : packages.map((item) => ({ id: item.id, label: `${item.name} · PKR ${Number(item.price).toLocaleString()}` }))
  const selectedCatalog = availableCatalog.find((item) => item.id === catalogId)
  const discount = Number(discountPercent)
  const discountReason = [discountReasonChoice, discountReasonText.trim()].filter(Boolean).join(": ")
  const requiresAdminApproval = discountLimit !== null && discount > discountLimit && currentUser?.role !== "admin"

  function changeCatalogType(type: "test" | "package") {
    setCatalogType(type)
    setCatalogId(type === "test" ? tests[0]?.id ?? "" : packages[0]?.id ?? "")
  }

  async function createOrder() {
    setError("")
    if (!patientId) { setError("Select a patient."); return }
    if (!selectedCatalog) { setError("Select an active Lab test or package."); return }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) { setError("Discount must be from 0 to 100%."); return }
    if (discount > 0 && !discountReasonText.trim()) { setError("Enter a free-text reason for the discount."); return }
    if (discountLimit === null) { setError("The cashier discount limit is still loading."); return }

    setSaving(true)
    try {
      const approval = requiresAdminApproval
        ? (() => {
          if (!adminEmail.trim() || !adminPassword) throw new Error("Admin email and password are required to approve this discount.")
          return api.login(adminEmail.trim(), adminPassword)
        })()
        : null
      const adminLogin = approval ? await approval : null
      if (adminLogin && adminLogin.user.role !== "ADMIN") throw new Error("Discount approval must use an Admin account.")
      const approvalHeaders = adminLogin ? { token: adminLogin.accessToken } : undefined
      const common = {
        patientId,
        priority,
        ...(referringClinicAccountId ? { referringClinicAccountId } : {}),
        ...(discount > 0 ? { discountPercent: discount, discountReason } : {}),
      }
      let invoiceNumber = ""
      if (catalogType === "package") {
        const created = await api.createLabPackageOrder({ ...common, packageId: selectedCatalog.id }, approvalHeaders)
        invoiceNumber = created.invoice.invoiceNumber
      } else {
        const created = await api.createLabOrder({ ...common, testId: selectedCatalog.id }, approvalHeaders)
        invoiceNumber = created.invoice?.invoiceNumber ?? ""
      }
      onClose()
      toast({ title: "Lab order created", description: invoiceNumber ? `Invoice ${invoiceNumber} generated from catalog pricing.` : "Invoice created from catalog pricing.", variant: "success" })
      const refreshes = [
        api.listLabOrders().then((orders) => dispatch({ type: "SET_LAB_ORDERS", labOrders: orders.map((order) => toLabOrder(order)) })),
        ...(currentUser && ["admin", "billing_manager", "receptionist"].includes(currentUser.role)
          ? [api.listInvoices().then((invoices) => dispatch({ type: "SET_INVOICES", invoices: invoices.map((invoice) => toInvoice(invoice)) }))]
          : []),
      ]
      void Promise.allSettled(refreshes).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          toast({ title: "Order created; dashboard refresh failed", description: "Reload the page to refresh the Lab order and invoice lists.", variant: "error" })
        }
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to create the Lab order."
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Lab order" size="md">
      <div className="flex flex-col gap-4">
        {error && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">{error}</p>}
        {loading ? <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading active tests and packages…</p> : <>
          <div><Label htmlFor="lab-order-patient">Patient *</Label>
            <select id="lab-order-patient" value={patientId} onChange={(event) => setPatientId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
              <option value="">Select patient</option>
              {patients.filter((patient) => patient.id).map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.mrNumber}</option>)}
            </select>
          </div>
          <div><Label htmlFor="lab-order-referring-clinic">Referring clinic (optional)</Label>
            <select id="lab-order-referring-clinic" value={referringClinicAccountId} onChange={(event) => setReferringClinicAccountId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
              <option value="">Bill the patient</option>
              {referringClinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.partyName}</option>)}
            </select>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">The invoice balance will be posted to the selected clinic's Lab receivable account.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="lab-order-catalog-type">Order type</Label>
              <select id="lab-order-catalog-type" value={catalogType} onChange={(event) => changeCatalogType(event.target.value as "test" | "package")} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
                <option value="test">Single test</option><option value="package">Package</option>
              </select>
            </div>
            <div><Label htmlFor="lab-order-catalog-item">{catalogType === "test" ? "Test" : "Package"} *</Label>
              <select id="lab-order-catalog-item" value={catalogId} onChange={(event) => setCatalogId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
                {availableCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
          </div>
          <div><Label htmlFor="lab-order-priority">Priority</Label>
            <select id="lab-order-priority" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
              <option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="lab-order-discount">Discount (%)</Label><Input id="lab-order-discount" type="number" min="0" max="100" step="0.01" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Cashier maximum: {discountLimit === null ? "Loading…" : `${discountLimit}%`}</p></div>
            <div><Label htmlFor="lab-order-discount-quick">Quick reason</Label>
              <select id="lab-order-discount-quick" value={discountReasonChoice} onChange={(event) => setDiscountReasonChoice(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm">
                <option value="">Select a reason (optional)</option>{QUICK_DISCOUNT_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
              </select>
            </div>
          </div>
          {discount > 0 && <div><Label htmlFor="lab-order-discount-reason">Discount reason *</Label><Input id="lab-order-discount-reason" maxLength={500} value={discountReasonText} onChange={(event) => setDiscountReasonText(event.target.value)} placeholder="Explain why this discount is applied" /></div>}
          {requiresAdminApproval && <div className="grid gap-3 rounded-lg border border-[var(--cp-warning)] bg-[var(--cp-warning-light)] p-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><p className="text-sm font-semibold">Admin approval required</p><p className="text-xs text-[var(--cp-ink-soft)]">Discounts above {discountLimit}% require a verified Admin login.</p></div>
            <div><Label htmlFor="lab-order-admin-email">Admin email</Label><Input id="lab-order-admin-email" type="email" autoComplete="username" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} /></div>
            <div><Label htmlFor="lab-order-admin-password">Admin password</Label><Input id="lab-order-admin-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /></div>
          </div>}
        </>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void createOrder()} disabled={loading || saving || !selectedCatalog}>{saving ? "Creating…" : "Create order and invoice"}</Button>
        </div>
      </div>
    </Modal>
  )
}
