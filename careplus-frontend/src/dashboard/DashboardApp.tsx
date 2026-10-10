import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Routes, Route, useLocation, useNavigate } from "react-router-dom"
import { DashboardProvider } from "@/dashboard/store/DashboardContext"
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
const InvoiceDetail = lazy(() => import("@/dashboard/pages/billing/InvoiceDetail"))
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
const DashboardNotFound = lazy(() => import("@/dashboard/pages/DashboardNotFound"))

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
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><PatientList /></RoleGuard></DashboardShell>}
        />
        <Route
          path="patients/:mrNumber"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"]}><PatientProfile /></RoleGuard></DashboardShell>}
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
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><LabDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/orders"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><LabOrdersPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/reports"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "lab_technician", "pathologist"]}><LabReportsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/ledger"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager"]}><LabLedgerPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/catalog"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><LabCatalogPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/settings"
          element={<DashboardShell><RoleGuard allow={["admin"]}><LabSettingsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/inventory"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><LabInventoryPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/invoices"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist"]}><LabInvoicesPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/:orderId"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"]}><LabOrderDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ultrasound"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "ultrasound_tech", "ultrasound_technician", "radiologist", "nurse"]}><UltrasoundDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/billing"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyBillingPage /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/discount-audit"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyDiscountAuditPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/invoices"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyInvoicesPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/settings"
          element={<DashboardShell><RoleGuard allow={["admin"]}><PharmacySettingsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/reports"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyReportsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/khata"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyKhataPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/sale-adjustments"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacySaleAdjustmentsPage /></RoleGuard></DashboardShell>}
        />
        <Route
          path="pharmacy/invoices/:invoiceId"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><InvoiceDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy/legacy-sale"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyDashboard initialSaleOpen /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "pharmacist"]}><PharmacyDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="billing"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist"]}><BillingDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="billing/:invoiceId"
          element={<DashboardShell><RoleGuard allow={["admin", "billing_manager", "receptionist"]}><InvoiceDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="nurse"
          element={<DashboardShell><RoleGuard allow={["admin", "nurse"]}><NursePanel /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ward"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "nurse"]}><WardDashboard /></RoleGuard></DashboardShell>}
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
          element={<DashboardShell><RoleGuard allow={["admin"]}><ReportsPage /></RoleGuard></DashboardShell>}
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

        <Route index element={<Login />} />
        <Route path="*" element={<DashboardShell><DashboardNotFound /></DashboardShell>} />
        </Routes>
      </Suspense>
    </DashboardProvider>
  )
}
