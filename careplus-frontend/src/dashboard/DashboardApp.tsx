import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { Navigate, Routes, Route, useLocation, useNavigate } from "react-router-dom"
import { DashboardProvider } from "@/dashboard/store/DashboardContext"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { DashboardShell, RoleGuard } from "@/dashboard/components/Layout"
import { getAccessToken, getAccessTokenExpiration, keepSessionSignedIn } from "@/lib/api"
import { Button } from "@/components/ui/button"
import AdminDashboard from "@/dashboard/pages/admin/AdminDashboard"
import PatientList from "@/dashboard/pages/patients/PatientList"
import PharmacyDashboard from "@/dashboard/pages/pharmacy/PharmacyDashboard"
import PharmacyBillingPage from "@/dashboard/pages/pharmacy/PharmacyBillingPage"
import BillingDashboard from "@/dashboard/pages/billing/BillingDashboard"
import WardDashboard from "@/dashboard/pages/ward/WardDashboard"

const Login = lazy(() => import("@/dashboard/pages/Login"))
const PatientProfile = lazy(() => import("@/dashboard/pages/patients/PatientProfile"))
const AppointmentsPage = lazy(() => import("@/dashboard/pages/appointments/AppointmentsPage"))
const OPDQueue = lazy(() => import("@/dashboard/pages/appointments/OPDQueue"))
const DoctorDashboard = lazy(() => import("@/dashboard/pages/doctor/DoctorDashboard"))
const DoctorConsultation = lazy(() => import("@/dashboard/pages/doctor/DoctorConsultation"))
const ConsultationRecord = lazy(() => import("@/dashboard/pages/doctor/ConsultationRecord"))
const LabDashboard = lazy(() => import("@/dashboard/pages/lab/LabDashboard"))
const LabOrdersPage = lazy(() => import("@/dashboard/pages/lab/LabOrdersPage"))
const LabReportsPage = lazy(() => import("@/dashboard/pages/lab/LabReportsPage"))
const LabLedgerPage = lazy(() => import("@/dashboard/pages/lab/LabLedgerPage"))
const LabInvoicesPage = lazy(() => import("@/dashboard/pages/lab/LabInvoicesPage"))
const LabCatalogPage = lazy(() => import("@/dashboard/pages/lab/LabCatalogPage"))
const LabSettingsPage = lazy(() => import("@/dashboard/pages/lab/LabSettingsPage"))
const LabInventoryPage = lazy(() => import("@/dashboard/pages/lab/LabInventoryPage"))
const LabOrderDetail = lazy(() => import("@/dashboard/pages/lab/LabOrderDetail"))
const UltrasoundDashboard = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundDashboard"))
const UltrasoundOverviewPage = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundOverviewPage"))
const UltrasoundReportsPage = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundReportsPage"))
const UltrasoundAuditTrailPage = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundAuditTrailPage"))
const InvoiceDetail = lazy(() => import("@/dashboard/pages/billing/InvoiceDetail"))
const DepartmentBillingPanel = lazy(() => import("@/dashboard/pages/billing/DepartmentBillingPanel"))
const DepartmentWorkspace = lazy(() => import("@/dashboard/pages/billing/DepartmentWorkspace"))
const NursePanel = lazy(() => import("@/dashboard/pages/nurse/NursePanel"))
const OTDashboard = lazy(() => import("@/dashboard/pages/ot/OTDashboard"))
const WardRoundPage = lazy(() => import("@/dashboard/pages/ward/WardRoundPage"))
const SurgeryDetail = lazy(() => import("@/dashboard/pages/ot/SurgeryDetail"))
const ReportsPage = lazy(() => import("@/dashboard/pages/reports/ReportsPage"))
const SettingsPage = lazy(() => import("@/dashboard/pages/settings/SettingsPage"))
const AuditLogsPage = lazy(() => import("@/dashboard/pages/audit/AuditLogsPage"))
const PharmacyDiscountAuditPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyDiscountAuditPage"))
const PharmacySaleAdjustmentsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacySaleAdjustmentsPage"))
const PharmacyInvoicesPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyInvoicesPage"))
const PharmacySettingsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacySettingsPage"))
const PharmacyReportsPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyReportsPage"))
const PharmacyKhataPage = lazy(() => import("@/dashboard/pages/pharmacy/PharmacyKhataPage"))
const UsersPage = lazy(() => import("@/dashboard/pages/admin/UsersPage"))
const BackupPage = lazy(() => import("@/dashboard/pages/admin/BackupPage"))
const ForgotPassword = lazy(() => import("@/dashboard/pages/ForgotPassword"))
const ResetPassword = lazy(() => import("@/dashboard/pages/ResetPassword"))
const DashboardNotFound = lazy(() => import("@/dashboard/pages/DashboardNotFound"))

type WorkspaceDepartment = "LAB" | "PHARMACY" | "ULTRASOUND"

function DepartmentRoot({ department, fallback }: { department: WorkspaceDepartment; fallback: ReactNode }) {
  const { currentUser } = useDashboard()
  if (currentUser?.role === "admin" || currentUser?.role === "billing_manager") {
    return <DepartmentWorkspace department={department} />
  }
  return <>{fallback}</>
}

function DepartmentRouteRedirect({
  department,
  section,
  manage,
  fallback,
}: {
  department: WorkspaceDepartment
  section: "overview" | "work-items" | "billing" | "history" | "manage"
  manage?: string
  fallback: ReactNode
}) {
  const { currentUser } = useDashboard()
  const location = useLocation()
  if (currentUser?.role !== "admin" && currentUser?.role !== "billing_manager") return <>{fallback}</>
  const destinationSection = currentUser.role === "billing_manager"
    ? section === "billing" ? "billing" : "history"
    : section
  const query = new URLSearchParams(location.search)
  query.set("section", destinationSection)
  if (currentUser.role === "admin" && manage) query.set("manage", manage)
  else query.delete("manage")
  return <Navigate to={`/dashboard/${department.toLowerCase()}?${query.toString()}`} replace />
}

const DEFAULT_WARNING_LEAD_MS = 2 * 60_000
const DEFAULT_INACTIVITY_TIMEOUT_MS = 13 * 60_000

function getSessionTiming() {
  const environment = import.meta.env as ImportMetaEnv & Record<string, string | undefined>
  const runtime = typeof window === "undefined"
    ? undefined
    : (window as Window & { __CAREPLUS_SESSION_CONFIG__?: { warningLeadMs?: number; inactivityTimeoutMs?: number } }).__CAREPLUS_SESSION_CONFIG__
  const warningLead = runtime?.warningLeadMs ?? Number(environment.VITE_SESSION_WARNING_LEAD_MS)
  const inactivityTimeout = runtime?.inactivityTimeoutMs ?? Number(environment.VITE_SESSION_INACTIVITY_TIMEOUT_MS)
  return {
    warningLeadMs: Number.isFinite(warningLead) && warningLead > 0 ? warningLead : DEFAULT_WARNING_LEAD_MS,
    inactivityTimeoutMs: Number.isFinite(inactivityTimeout) && inactivityTimeout > 0 ? inactivityTimeout : DEFAULT_INACTIVITY_TIMEOUT_MS,
  }
}

function SessionTimeoutWarning() {
  const [warning, setWarning] = useState(false)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const timerRef = useRef<number | null>(null)
  const lastActivityRef = useRef(Date.now())
  const checkingRef = useRef(false)

  useEffect(() => {
    const { warningLeadMs, inactivityTimeoutMs } = getSessionTiming()
    let disposed = false

    const clearTimer = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const redirectToLogin = () => {
      clearTimer()
      setWarning(false)
      navigate("/dashboard/login", {
        replace: true,
        state: {
          sessionExpired: true,
          returnTo: `${location.pathname}${location.search}${location.hash}`,
        },
      })
    }

    const schedule = () => {
      clearTimer()
      const token = getAccessToken()
      const expiresAt = getAccessTokenExpiration()
      if (!token || expiresAt === null) {
        setWarning(false)
        return
      }

      const now = Date.now()
      const inactivityAt = lastActivityRef.current + inactivityTimeoutMs
      if (inactivityAt <= now) {
        setWarning(true)
        return
      }
      setWarning(false)
      const refreshAt = expiresAt - warningLeadMs
      if (refreshAt <= now) {
        checkingRef.current = true
        void keepSessionSignedIn().then((renewed) => {
          if (!renewed && !disposed) redirectToLogin()
        }).finally(() => {
          checkingRef.current = false
          if (!disposed && getAccessToken()) schedule()
        })
        return
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (Date.now() - lastActivityRef.current >= inactivityTimeoutMs) {
          setWarning(true)
          return
        }
        if (Date.now() >= refreshAt && !checkingRef.current) {
          checkingRef.current = true
          void keepSessionSignedIn().then((renewed) => {
            if (!renewed && !disposed) redirectToLogin()
          }).finally(() => {
            checkingRef.current = false
            if (!disposed && getAccessToken()) schedule()
          })
          return
        }
        schedule()
      }, Math.max(0, Math.min(inactivityAt, refreshAt) - now))
    }

    const markActivity = (event: Event) => {
      lastActivityRef.current = Date.now()
      if (event.target instanceof Element && event.target.closest("[data-session-timeout-warning]")) return
      setWarning(false)
      schedule()
    }
    const expire = () => redirectToLogin()
    const activityEvents = ["pointerdown", "keydown", "input", "touchstart", "scroll", "careplus:activity"]
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    window.addEventListener("careplus:session-expired", expire)
    schedule()
    return () => {
      disposed = true
      clearTimer()
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
      window.removeEventListener("careplus:session-expired", expire)
    }
  }, [location.hash, location.pathname, location.search, navigate])

  useEffect(() => {
    lastActivityRef.current = Date.now()
    window.dispatchEvent(new Event("careplus:activity"))
  }, [location.key])

  async function staySignedIn() {
    setBusy(true)
    const renewed = await keepSessionSignedIn()
    setBusy(false)
    if (!renewed) {
      navigate("/dashboard/login", {
        replace: true,
        state: {
          sessionExpired: true,
          returnTo: `${location.pathname}${location.search}${location.hash}`,
        },
      })
      return
    }
    lastActivityRef.current = Date.now()
    setWarning(false)
    window.dispatchEvent(new Event("careplus:activity"))
  }

  if (!warning) return null
  return (
    <div role="alert" data-session-timeout-warning className="fixed bottom-4 left-1/2 z-[120] flex w-[min(94vw,34rem)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xl">
      <span>Your session will expire soon. Stay signed in to continue working.</span>
      <Button size="sm" onClick={() => void staySignedIn()} disabled={busy}>{busy ? "Renewing…" : "Stay signed in"}</Button>
    </div>
  )
}

export default function DashboardApp() {
  return (
    <DashboardProvider>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[var(--cp-ink-soft)]">Loading dashboard…</div>}>
        <SessionTimeoutWarning />
        <Routes>
        <Route path="login" element={<Login />} />

        <Route
          path="admin"
          element={<DashboardShell><RoleGuard allow={["admin"]}><AdminDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="patients"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><PatientList /></RoleGuard></DashboardShell>}
        />
        <Route
          path="patients/:mrNumber"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><PatientProfile /></RoleGuard></DashboardShell>}
        />

        <Route
          path="appointments"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "nurse"]}><AppointmentsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="queue"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "nurse"]}><OPDQueue /></RoleGuard></DashboardShell>}
        />

        <Route
          path="doctor"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor"]}><DoctorDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="doctor/consultation/:appointmentId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor"]}><DoctorConsultation /></RoleGuard></DashboardShell>}
        />
        <Route
          path="doctor/consultation-record/:consultationId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor"]}><ConsultationRecord /></RoleGuard></DashboardShell>}
        />

        <Route
          path="lab"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><DepartmentRoot department="LAB" fallback={<LabDashboard />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/orders"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><DepartmentRouteRedirect department="LAB" section="work-items" fallback={<LabOrdersPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/reports"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "lab_technician", "pathologist"]}><DepartmentRouteRedirect department="LAB" section="manage" manage="reports" fallback={<LabReportsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/ledger"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager"]}><DepartmentRouteRedirect department="LAB" section="manage" manage="ledger" fallback={<LabLedgerPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/catalog"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><DepartmentRouteRedirect department="LAB" section="manage" manage="catalog" fallback={<LabCatalogPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/settings"
          element={<DashboardShell><RoleGuard allow={["admin"]}><DepartmentRouteRedirect department="LAB" section="manage" manage="settings" fallback={<LabSettingsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/inventory"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><DepartmentRouteRedirect department="LAB" section="manage" manage="inventory" fallback={<LabInventoryPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/invoices"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist", "lab_technician"]}><DepartmentRouteRedirect department="LAB" section="history" fallback={<LabInvoicesPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/billing"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "lab_technician"]}><DepartmentRouteRedirect department="LAB" section="billing" fallback={<DepartmentBillingPanel department="LAB" title="Lab Billing" />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/:orderId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><LabOrderDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ultrasound/overview"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><DepartmentRouteRedirect department="ULTRASOUND" section="overview" fallback={<UltrasoundOverviewPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ultrasound/reports"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><DepartmentRouteRedirect department="ULTRASOUND" section="manage" manage="reports" fallback={<UltrasoundReportsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ultrasound/audit-trail"
          element={<DashboardShell><RoleGuard allow={["admin"]}><DepartmentRouteRedirect department="ULTRASOUND" section="manage" manage="audit-trail" fallback={<UltrasoundAuditTrailPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ultrasound/billing"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "ultrasound_tech", "ultrasound_technician"]}><DepartmentRouteRedirect department="ULTRASOUND" section="billing" fallback={<DepartmentBillingPanel department="ULTRASOUND" title="Ultrasound Billing" />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ultrasound"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "doctor", "receptionist", "lab_technician", "ultrasound_tech", "ultrasound_technician", "radiologist", "nurse"]}><DepartmentRoot department="ULTRASOUND" fallback={<UltrasoundDashboard />} /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/billing"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="pos-billing" fallback={<PharmacyBillingPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/invoice-history"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="history" fallback={<DepartmentBillingPanel department="PHARMACY" title="Pharmacy Billing History" />} /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/discount-audit"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="discount-audit" fallback={<PharmacyDiscountAuditPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/invoices"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="invoices" fallback={<PharmacyInvoicesPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/settings"
          element={<DashboardShell><RoleGuard allow={["admin"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="settings" fallback={<PharmacySettingsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/reports"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="reports" fallback={<PharmacyReportsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/khata"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="khata" fallback={<PharmacyKhataPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/sale-adjustments"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="manage" manage="sale-adjustments" fallback={<PharmacySaleAdjustmentsPage />} /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/invoices/:invoiceId"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><InvoiceDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/legacy-sale"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><DepartmentRouteRedirect department="PHARMACY" section="work-items" fallback={<PharmacyDashboard initialSaleOpen />} /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "doctor", "pharmacist"]}><DepartmentRoot department="PHARMACY" fallback={<PharmacyDashboard />} /></RoleGuard></DashboardShell>}
        />

        <Route
          path="billing/collect"
          element={<DashboardShell><RoleGuard allow={["receptionist"]}><DepartmentBillingPanel departments={["LAB", "PHARMACY", "ULTRASOUND"]} title="Collect Department Payments" collectOnly /></RoleGuard></DashboardShell>}
        />
        <Route
          path="billing"
          element={<DashboardShell><RoleGuard module="billing" action="view" allow={["admin", "billing_manager", "receptionist"]}><BillingDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="billing/:invoiceId"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist", "lab_technician", "pharmacist", "ultrasound_tech", "ultrasound_technician"]}><InvoiceDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="nurse"
          element={<DashboardShell><RoleGuard allow={["admin", "nurse"]}><NursePanel /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ward"
          element={<DashboardShell><RoleGuard module="ward" action="view" allow={["admin", "receptionist", "doctor", "nurse"]}><WardDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ward/round/:admissionId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor"]}><WardRoundPage /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ot"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "nurse"]}><OTDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="ot/:surgeryId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "nurse"]}><SurgeryDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="reports"
          element={<DashboardShell><RoleGuard module="reports" action="view" allow={["admin"]}><ReportsPage /></RoleGuard></DashboardShell>}
        />

        <Route
          path="audit-logs"
          element={<DashboardShell><RoleGuard allow={["admin"]}><AuditLogsPage /></RoleGuard></DashboardShell>}
        />

        <Route
          path="settings"
          element={<DashboardShell><RoleGuard allow={["admin"]}><SettingsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="users"
          element={<DashboardShell><RoleGuard allow={["admin"]}><UsersPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="admin/backup"
          element={<DashboardShell><RoleGuard allow={["admin"]}><BackupPage /></RoleGuard></DashboardShell>}
        />

        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route index element={<Login />} />
        <Route path="login" element={<Login />} />
        <Route path="*" element={<DashboardShell><DashboardNotFound /></DashboardShell>} />
        </Routes>
      </Suspense>
    </DashboardProvider>
  )
}
