import * as React from "react"
import { Link, useLocation, Navigate } from "react-router-dom"
import { ChevronRight, ShieldAlert } from "lucide-react"
import { Sidebar } from "@/dashboard/components/Sidebar"
import { Header } from "@/dashboard/components/Header"
import { Toaster } from "@/components/shared/Toaster"
import { useDashboard } from "@/dashboard/store/useDashboard"
import { ROLE_LABELS, type Role } from "@/dashboard/types"
import { ROLE_ROUTES } from "@/dashboard/nav"
import { Button } from "@/components/ui/button"

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  admin: "Overview",
  patients: "Patients",
  appointments: "Appointments",
  queue: "OPD Queue",
  doctor: "Doctor Panel",
  consultation: "Consultation",
  lab: "Lab",
  pharmacy: "Pharmacy",
  billing: "Billing",
  nurse: "Ward & Vitals",
  login: "Login",
  users: "Users",
}

export function Breadcrumbs() {
  const location = useLocation()
  const parts = location.pathname.split("/").filter(Boolean)
  if (parts.length <= 1) return null

  let acc = ""
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-[var(--cp-ink-soft)]">
      {parts.map((part, i) => {
        acc += `/${part}`
        const isLast = i === parts.length - 1
        const label = LABELS[part] ?? decodeURIComponent(part)
        return (
          <span key={acc} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-[var(--cp-ink-faint)]" />}
            {isLast ? (
              <span className="font-medium text-[var(--cp-ink)]">{label}</span>
            ) : (
              <Link to={acc} className="hover:text-[var(--cp-primary)]">{label}</Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function DashboardPageHeader({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-[var(--cp-ink)] sm:text-2xl">{title}</h1>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { currentUser, authReady, dataLoading, dataError } = useDashboard()
  if (!authReady) return null
  if (!currentUser) return <Navigate to="/dashboard/login" replace />

  return (
    <div className="flex min-h-screen bg-[var(--cp-bg)]">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        <Header />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-7xl">
            <Breadcrumbs />
            {dataLoading && <p className="mb-4 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 py-3 text-sm text-[var(--cp-ink-soft)]">Loading live hospital data...</p>}
            {dataError && <p role="alert" className="mb-4 rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-4 py-3 text-sm text-[var(--cp-critical)]">{dataError}</p>}
            {children}
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  )
}

export function RoleGuard({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const { currentUser } = useDashboard()
  if (!currentUser) return null
  if (!allow.includes(currentUser.role)) return <NotPermitted />
  return <>{children}</>
}

export function NotPermitted() {
  const { currentUser } = useDashboard()
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-surface)] px-6 py-20 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--cp-critical-light)] text-[var(--cp-critical)]">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <h2 className="mb-1.5 text-lg font-bold text-[var(--cp-ink)]">Not permitted for your role</h2>
      <p className="mb-5 max-w-sm text-sm text-[var(--cp-ink-soft)]">
        {currentUser ? ROLE_LABELS[currentUser.role] : "Your role"} does not have access to this section of Khalida Medicare Hospital.
      </p>
      {currentUser && (
        <Link to={ROLE_ROUTES[currentUser.role]}>
          <Button variant="outline" size="sm">Back to my dashboard</Button>
        </Link>
      )}
    </div>
  )
}
