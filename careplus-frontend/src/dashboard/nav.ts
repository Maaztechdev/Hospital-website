import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard, Users, CalendarClock, ListOrdered, Stethoscope, FlaskConical,
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
    { label: "Ultrasound", path: "/dashboard/ultrasound", icon: ScanLine },
    { label: "Pharmacy", path: "/dashboard/pharmacy", icon: Pill },
    { label: "Billing", path: "/dashboard/billing", icon: Receipt },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Nurse Panel", path: "/dashboard/nurse", icon: HeartPulse },
    { label: "Operation Theatre", path: "/dashboard/ot", icon: Syringe },
    { label: "Reports", path: "/dashboard/reports", icon: BarChart3 },
    { label: "Audit Logs", path: "/dashboard/audit-logs", icon: ScrollText },
    { label: "Settings", path: "/dashboard/settings", icon: Settings },
    { label: "Users", path: "/dashboard/users", icon: Users },
    { label: "Backup & Restore", path: "/dashboard/admin/backup", icon: DatabaseBackup },
  ],
  receptionist: [
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Appointments", path: "/dashboard/appointments", icon: CalendarClock },
    { label: "OPD Queue", path: "/dashboard/queue", icon: ListOrdered },
    { label: "Billing", path: "/dashboard/billing", icon: Receipt },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
  ],
  doctor: [
    { label: "My Dashboard", path: "/dashboard/doctor", icon: Stethoscope },
    { label: "Appointments", path: "/dashboard/appointments", icon: CalendarClock },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Operation Theatre", path: "/dashboard/ot", icon: Syringe },
  ],
  lab_technician: [
    { label: "Lab Dashboard", path: "/dashboard/lab", icon: FlaskConical },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
  ultrasound_technician: [{ label: "Ultrasound", path: "/dashboard/ultrasound", icon: ScanLine }, { label: "Patients", path: "/dashboard/patients", icon: Users }],
  radiologist: [{ label: "Ultrasound", path: "/dashboard/ultrasound", icon: ScanLine }, { label: "Patients", path: "/dashboard/patients", icon: Users }],
  pharmacist: [
    { label: "Pharmacy", path: "/dashboard/pharmacy", icon: Pill },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
  nurse: [
    { label: "Nurse Panel", path: "/dashboard/nurse", icon: HeartPulse },
    { label: "Ward Board", path: "/dashboard/ward", icon: BedDouble },
    { label: "Patients", path: "/dashboard/patients", icon: Users },
  ],
}

export const ALL_ROLES: Role[] = ["admin", "receptionist", "doctor", "lab_technician", "ultrasound_technician", "radiologist", "pharmacist", "nurse"]

export const ROLE_ROUTES: Record<Role, string> = {
  admin: "/dashboard/admin",
  receptionist: "/dashboard/appointments",
  doctor: "/dashboard/doctor",
  lab_technician: "/dashboard/lab",
  ultrasound_technician: "/dashboard/ultrasound",
  radiologist: "/dashboard/ultrasound",
  pharmacist: "/dashboard/pharmacy",
  nurse: "/dashboard/nurse",
}

export const LockIcon = Lock
