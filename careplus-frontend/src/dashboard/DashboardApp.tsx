import { lazy, Suspense } from "react"
import { Routes, Route } from "react-router-dom"
import { DashboardProvider } from "@/dashboard/store/DashboardContext"
import { DashboardShell, RoleGuard } from "@/dashboard/components/Layout"
import AdminDashboard from "@/dashboard/pages/admin/AdminDashboard"
import PatientList from "@/dashboard/pages/patients/PatientList"
import PharmacyDashboard from "@/dashboard/pages/pharmacy/PharmacyDashboard"
import BillingDashboard from "@/dashboard/pages/billing/BillingDashboard"
import WardDashboard from "@/dashboard/pages/ward/WardDashboard"

const Login = lazy(() => import("@/dashboard/pages/Login"))
const PatientProfile = lazy(() => import("@/dashboard/pages/patients/PatientProfile"))
const AppointmentsPage = lazy(() => import("@/dashboard/pages/appointments/AppointmentsPage"))
const OPDQueue = lazy(() => import("@/dashboard/pages/appointments/OPDQueue"))
const DoctorDashboard = lazy(() => import("@/dashboard/pages/doctor/DoctorDashboard"))
const DoctorConsultation = lazy(() => import("@/dashboard/pages/doctor/DoctorConsultation"))
const LabDashboard = lazy(() => import("@/dashboard/pages/lab/LabDashboard"))
const LabOrderDetail = lazy(() => import("@/dashboard/pages/lab/LabOrderDetail"))
const UltrasoundDashboard = lazy(() => import("@/dashboard/pages/ultrasound/UltrasoundDashboard"))
const InvoiceDetail = lazy(() => import("@/dashboard/pages/billing/InvoiceDetail"))
const NursePanel = lazy(() => import("@/dashboard/pages/nurse/NursePanel"))
const OTDashboard = lazy(() => import("@/dashboard/pages/ot/OTDashboard"))
const SurgeryDetail = lazy(() => import("@/dashboard/pages/ot/SurgeryDetail"))
const ReportsPage = lazy(() => import("@/dashboard/pages/reports/ReportsPage"))
const SettingsPage = lazy(() => import("@/dashboard/pages/settings/SettingsPage"))
const AuditLogsPage = lazy(() => import("@/dashboard/pages/audit/AuditLogsPage"))
const UsersPage = lazy(() => import("@/dashboard/pages/admin/UsersPage"))
const BackupPage = lazy(() => import("@/dashboard/pages/admin/BackupPage"))
const DashboardNotFound = lazy(() => import("@/dashboard/pages/DashboardNotFound"))

export default function DashboardApp() {
  return (
    <DashboardProvider>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-[var(--cp-ink-soft)]">Loading dashboard…</div>}>
        <Routes>
        <Route path="login" element={<Login />} />

        <Route
          path="admin"
          element={<DashboardShell><RoleGuard allow={["admin"]}><AdminDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="patients"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse"]}><PatientList /></RoleGuard></DashboardShell>}
        />
        <Route
          path="patients/:mrNumber"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse"]}><PatientProfile /></RoleGuard></DashboardShell>}
        />

        <Route
          path="appointments"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist", "doctor"]}><AppointmentsPage /></RoleGuard></DashboardShell>}
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
          path="lab"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><LabDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="lab/:orderId"
          element={<DashboardShell><RoleGuard allow={["admin", "lab_technician"]}><LabOrderDetail /></RoleGuard></DashboardShell>}
        />

        <Route
          path="ultrasound"
          element={<DashboardShell><RoleGuard allow={["admin", "doctor", "receptionist", "lab_technician", "ultrasound_technician", "radiologist", "nurse"]}><UltrasoundDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="pharmacy"
          element={<DashboardShell><RoleGuard allow={["admin", "pharmacist"]}><PharmacyDashboard /></RoleGuard></DashboardShell>}
        />

        <Route
          path="billing"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist"]}><BillingDashboard /></RoleGuard></DashboardShell>}
        />
        <Route
          path="billing/:invoiceId"
          element={<DashboardShell><RoleGuard allow={["admin", "receptionist"]}><InvoiceDetail /></RoleGuard></DashboardShell>}
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
