import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard, Users, CalendarClock, ListOrdered, Stethoscope, FlaskConical, TestTube2, Package,
  Pill, Receipt, HeartPulse, Lock, BedDouble, Syringe, BarChart3, Settings, ScrollText, ScanLine, DatabaseBackup,
} from "lucide-react"
import type { Role } from "@/dashboard/types"

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  disabled?: boolean
  badge?: string
}

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { label: "Overview", path: "/dashboard/admin", icon: LayoutDashboard },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Appointments", path: "/dashboard/appointments", icon: CalendarClock },
    { label: "OPD Queue", path: "/dashboard/queue", icon: ListOrdered },
    { label: "Doctor Panel", path: "/dashboard/doctor", icon: Stethoscope },
    { label: "Lab", path: "/dashboard/lab", icon: FlaskConical },
    { label: "Pharmacy", path: "/dashboard/pharmacy", icon: Pill },
    { label: "Ultrasound", path: "/dashboard/ultrasound", icon: ScanLine },
    { label: "All billing", path: "/dashboard/billing", icon: Receipt },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Nurse Panel", path: "/dashboard/nurse", icon: HeartPulse },
    { label: "Operation Theatre", path: "/dashboard/ot", icon: Syringe },
    { label: "Reports", path: "/dashboard/reports", icon: BarChart3 },
    { label: "Audit Logs", path: "/dashboard/audit-logs", icon: ScrollText },
    { label: "Settings", path: "/dashboard/settings", icon: Settings },
    { label: "Users", path: "/dashboard/users", icon: Users },
    { label: "Backup & Restore", path: "/dashboard/admin/backup", icon: DatabaseBackup },
  ],
  billing_manager: [
    { label: "All billing", path: "/dashboard/billing", icon: Receipt },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Lab billing", path: "/dashboard/lab?section=billing", icon: FlaskConical },
    { label: "Pharmacy billing", path: "/dashboard/pharmacy?section=billing", icon: Pill },
    { label: "Ultrasound billing", path: "/dashboard/ultrasound?section=billing", icon: ScanLine },
  ],
  receptionist: [
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Appointments", path: "/dashboard/appointments", icon: CalendarClock },
    { label: "OPD Queue", path: "/dashboard/queue", icon: ListOrdered },
    { label: "Billing", path: "/dashboard/billing", icon: Receipt },
    { label: "Collect Payments", path: "/dashboard/billing/collect", icon: Receipt },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview", icon: ScanLine },
    { label: "Ultrasound Queue", path: "/dashboard/ultrasound", icon: ScanLine },
  ],
  doctor: [
    { label: "My Dashboard", path: "/dashboard/doctor", icon: Stethoscope },
    { label: "Appointments", path: "/dashboard/appointments", icon: CalendarClock },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Operation Theatre", path: "/dashboard/ot", icon: Syringe },
    { label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview", icon: ScanLine },
    { label: "Ultrasound Queue", path: "/dashboard/ultrasound", icon: ScanLine },
    { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports", icon: BarChart3 },
  ],
  lab_technician: [
    { label: "Lab Dashboard", path: "/dashboard/lab", icon: FlaskConical },
    { label: "Lab Billing", path: "/dashboard/lab/billing", icon: Receipt },
    { label: "Lab Reports", path: "/dashboard/lab/reports", icon: BarChart3 },
    { label: "Test Catalog", path: "/dashboard/lab/catalog", icon: TestTube2 },
    { label: "Lab Inventory", path: "/dashboard/lab/inventory", icon: Package },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
  pathologist: [
    { label: "Lab Dashboard", path: "/dashboard/lab", icon: FlaskConical },
    { label: "Lab Reports", path: "/dashboard/lab/reports", icon: BarChart3 },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
  ultrasound_tech: [{ label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview", icon: ScanLine }, { label: "Ultrasound Queue", path: "/dashboard/ultrasound", icon: ScanLine }, { label: "Ultrasound Billing", path: "/dashboard/ultrasound/billing", icon: Receipt }, { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports", icon: BarChart3 }, { label: "Patients", path: "/dashboard/patients", icon: Users }],
  ultrasound_technician: [{ label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview", icon: ScanLine }, { label: "Ultrasound Queue", path: "/dashboard/ultrasound", icon: ScanLine }, { label: "Ultrasound Billing", path: "/dashboard/ultrasound/billing", icon: Receipt }, { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports", icon: BarChart3 }, { label: "Patients", path: "/dashboard/patients", icon: Users }],
  radiologist: [{ label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview", icon: ScanLine }, { label: "Ultrasound Queue", path: "/dashboard/ultrasound", icon: ScanLine }, { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports", icon: BarChart3 }, { label: "Patients", path: "/dashboard/patients", icon: Users }],
  pharmacist: [
    { label: "Pharmacy", path: "/dashboard/pharmacy", icon: Pill },
    { label: "Billing History", path: "/dashboard/pharmacy/invoice-history", icon: Receipt },
    { label: "Invoices", path: "/dashboard/pharmacy/invoices", icon: Receipt },
    { label: "Pharmacy Reports", path: "/dashboard/pharmacy/reports", icon: BarChart3 },
    { label: "Khata", path: "/dashboard/pharmacy/khata", icon: Receipt },
    { label: "Discount Audit", path: "/dashboard/pharmacy/discount-audit", icon: ScrollText },
    { label: "Voided Sales & Returns", path: "/dashboard/pharmacy/sale-adjustments", icon: ScrollText },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
  nurse: [
    { label: "Nurse Panel", path: "/dashboard/nurse", icon: HeartPulse },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
}

export const ALL_ROLES: Role[] = ["admin", "billing_manager", "receptionist", "doctor", "lab_technician", "pathologist", "ultrasound_tech", "ultrasound_technician", "radiologist", "pharmacist", "nurse"]

export const ROLE_ROUTES: Record<Role, string> = {
  admin: "/dashboard/admin",
  billing_manager: "/dashboard/billing",
  receptionist: "/dashboard/appointments",
  doctor: "/dashboard/doctor",
  lab_technician: "/dashboard/lab",
  pathologist: "/dashboard/lab",
  ultrasound_tech: "/dashboard/ultrasound",
  ultrasound_technician: "/dashboard/ultrasound",
  radiologist: "/dashboard/ultrasound",
  pharmacist: "/dashboard/pharmacy",
  nurse: "/dashboard/nurse",
}

export const LockIcon = Lock
