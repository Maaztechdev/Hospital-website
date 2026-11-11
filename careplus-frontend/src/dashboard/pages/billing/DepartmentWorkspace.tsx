import * as React from "react"
import { lazy, Suspense } from "react"
import { useSearchParams } from "react-router-dom"
import { AlertCircle, BedDouble, Receipt, RotateCcw, Wallet } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { StatCard } from "@/dashboard/components/StatCard"
import { Button } from "@/components/ui/button"
import { formatCurrency, getHospitalDateKey } from "@/dashboard/lib/format"
import { api, type ApiBillingSummary } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import DepartmentBillingPanel from "@/dashboard/pages/billing/DepartmentBillingPanel"
import { useDashboard } from "@/dashboard/store/DashboardContext"

const LabOrdersPage = lazy(() => import("@/dashboard/pages/lab/LabOrdersPage"))
const LabReportsPage = lazy(() => import("@/dashboard/pages/lab/LabReportsPage"))
const LabLedgerPage = lazy(() => import("@/dashboard/pages/lab/LabLedgerPage"))
const LabCatalogPage = lazy(() => import("@/dashboard/pages/lab/LabCatalogPage"))
const LabInventoryPage = lazy(() => import("@/dashboard/pages/lab/LabInventoryPage"))
const LabSettingsPage = lazy(() => import("@/dashboard/pages/lab/LabSettingsPage"))
const PharmacyDashboard = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyDashboard"))
const PharmacyBillingPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyBillingPage"))
const PharmacyInvoicesPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyInvoicesPage"))
const PharmacySettingsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacySettingsPage"))
const PharmacyReportsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyReportsPage"))
const PharmacyKhataPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyKhataPage"))
const PharmacyDiscountAuditPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyDiscountAuditPage"))
const PharmacySaleAdjustmentsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacySaleAdjustmentsPage"))
const UltrasoundDashboard = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundDashboard"))
const UltrasoundReportsPage = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundReportsPage"))
const UltrasoundAuditTrailPage = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundAuditTrailPage"))

type Department = "LAB" | "PHARMACY" | "ULTRASOUND"
type Section = "overview" | "work-items" | "billing" | "history" | "manage"

const DEPARTMENT_LABELS: Record<Department, string> = {
  LAB: "Lab",
  PHARMACY: "Pharmacy",
  ULTRASOUND: "Ultrasound",
}

const SECTION_LABELS: Record<Section, string> = {
  overview: "Overview",
  "work-items": "Work items",
  billing: "Billing",
  history: "History",
  manage: "Manage",
}

const ADMIN_SECTIONS: Section[] = ["overview", "work-items", "billing", "history", "manage"]
const BILLING_MANAGER_SECTIONS: Section[] = ["billing", "history"]

const MANAGEMENT_PAGES: Record<Department, Array<{ value: string; label: string; component: React.LazyExoticComponent<React.ComponentType> }>> = {
  LAB: [
    { value: "reports", label: "Reports", component: LabReportsPage },
    { value: "ledger", label: "Credit ledger", component: LabLedgerPage },
    { value: "catalog", label: "Test catalog", component: LabCatalogPage },
    { value: "inventory", label: "Inventory", component: LabInventoryPage },
    { value: "settings", label: "Settings", component: LabSettingsPage },
  ],
  PHARMACY: [
    { value: "pos-billing", label: "POS billing", component: PharmacyBillingPage },
    { value: "invoices", label: "Sales invoices", component: PharmacyInvoicesPage },
    { value: "reports", label: "Reports", component: PharmacyReportsPage },
    { value: "khata", label: "Khata", component: PharmacyKhataPage },
    { value: "discount-audit", label: "Discount audit", component: PharmacyDiscountAuditPage },
    { value: "sale-adjustments", label: "Voided sales & returns", component: PharmacySaleAdjustmentsPage },
    { value: "settings", label: "Settings", component: PharmacySettingsPage },
  ],
  ULTRASOUND: [
    { value: "reports", label: "Reports", component: UltrasoundReportsPage },
    { value: "audit-trail", label: "Audit trail", component: UltrasoundAuditTrailPage },
  ],
}

function BillingOverview({ department }: { department: Department }) {
  const { toast } = useToast()
  const today = getHospitalDateKey()
  const [dateFrom, setDateFrom] = React.useState(`${today.slice(0, 7)}-01`)
  const [dateTo, setDateTo] = React.useState(today)
  const [periodSummary, setPeriodSummary] = React.useState<ApiBillingSummary | null>(null)
  const [todaySummary, setTodaySummary] = React.useState<ApiBillingSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    Promise.all([
      api.getBillingSummary(dateFrom || undefined, dateTo || undefined),
      api.getBillingSummary(today, today),
    ])
      .then(([period, todayResult]) => {
        if (!active) return
        setPeriodSummary(period)
        setTodaySummary(todayResult)
      })
      .catch((cause: unknown) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : "Unable to load department billing totals."
        setError(message)
        toast({ title: "Unable to load billing totals", description: message, variant: "error" })
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dateFrom, dateTo, reloadKey, today, toast])

  const period = periodSummary?.departments.find((entry) => entry.department === department)
  const todayTotals = todaySummary?.departments.find((entry) => entry.department === department)
  const ipdAmount = periodSummary?.billedViaIpd.find((entry) => entry.sourceDepartment === department)?.amount ?? 0
  const values = [
    { label: "Invoiced", value: period?.invoiced, today: todayTotals?.invoiced, icon: Receipt },
    { label: "Collected", value: period?.collected, today: todayTotals?.collected, icon: Wallet },
    { label: "Refunded", value: period?.refunded, today: todayTotals?.refunded, icon: RotateCcw },
    { label: "Outstanding", value: period?.outstanding, today: todayTotals?.outstanding, icon: AlertCircle },
    { label: "Billed via IPD", value: ipdAmount, today: todaySummary?.billedViaIpd.find((entry) => entry.sourceDepartment === department)?.amount ?? 0, icon: BedDouble },
  ]

  return (
    <section className="flex flex-col gap-4" aria-label={`${DEPARTMENT_LABELS[department]} billing overview`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
          Period from
          <input aria-label="Period from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-ink)]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
          Period to
          <input aria-label="Period to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-ink)]" />
        </label>
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>Retry</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {values.map((item) => (
          <StatCard
            key={item.label}
            label={item.label}
            value={loading ? "Loading…" : formatCurrency(Number(item.value ?? 0))}
            icon={item.icon}
            description={`Today: ${loading ? "Loading…" : formatCurrency(Number(item.today ?? 0))}`}
            tone={item.label === "Outstanding" ? "warning" : "primary"}
          />
        ))}
      </div>
    </section>
  )
}

function WorkItems({ department }: { department: Department }) {
  if (department === "LAB") return <LabOrdersPage />
  if (department === "PHARMACY") return <PharmacyDashboard />
  return <UltrasoundDashboard />
}

export default function DepartmentWorkspace({ department }: { department: Department }) {
  const { currentUser } = useDashboard()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get("section") as Section | null
  const section: Section = currentUser?.role === "billing_manager"
    ? requested === "history" ? "history" : "billing"
    : requested && requested in SECTION_LABELS ? requested : "overview"
  const managePage = searchParams.get("manage") ?? MANAGEMENT_PAGES[department][0]?.value
  const managerView = currentUser?.role === "billing_manager"
  const visibleSections = managerView ? BILLING_MANAGER_SECTIONS : ADMIN_SECTIONS

  React.useEffect(() => {
    if (!visibleSections.includes(requested as Section)) {
      const next = new URLSearchParams(searchParams)
      next.set("section", visibleSections[0])
      setSearchParams(next, { replace: true })
    }
  }, [requested, searchParams, setSearchParams, visibleSections])

  const changeSection = (nextSection: Section) => {
    const next = new URLSearchParams(searchParams)
    next.set("section", nextSection)
    if (nextSection !== "manage") next.delete("manage")
    setSearchParams(next)
  }
  const selectedManagePage = MANAGEMENT_PAGES[department].find((page) => page.value === managePage) ?? MANAGEMENT_PAGES[department][0]
  const ManagePage = selectedManagePage?.component

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title={DEPARTMENT_LABELS[department]} />
      <div role="tablist" aria-label={`${DEPARTMENT_LABELS[department]} sections`} className="flex flex-wrap gap-2">
        {visibleSections.map((value) => (
          <Button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            variant={section === value ? "primary" : "outline"}
            size="sm"
            onClick={() => changeSection(value)}
          >
            {SECTION_LABELS[value]}
          </Button>
        ))}
      </div>

      {section === "overview" && <BillingOverview department={department} />}
      {section === "work-items" && <WorkItems department={department} />}
      {(section === "billing" || section === "history") && (
        <DepartmentBillingPanel
          department={department}
          title={`${DEPARTMENT_LABELS[department]} ${section === "history" ? "History" : "Billing"}`}
        />
      )}
      {section === "manage" && (
        <div className="flex flex-col gap-4">
          <label className="flex max-w-sm flex-col gap-1 text-xs text-[var(--cp-ink-soft)]">
            Management page
            <select
              aria-label="Management page"
              value={selectedManagePage?.value ?? ""}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams)
                next.set("section", "manage")
                next.set("manage", event.target.value)
                setSearchParams(next)
              }}
              className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-ink)]"
            >
              {MANAGEMENT_PAGES[department].map((page) => <option key={page.value} value={page.value}>{page.label}</option>)}
            </select>
          </label>
          {ManagePage && <Suspense fallback={<p role="status">Loading management page…</p>}><ManagePage /></Suspense>}
        </div>
      )}
    </div>
  )
}
