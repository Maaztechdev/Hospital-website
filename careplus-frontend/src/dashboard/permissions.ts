import type { Role } from "@/dashboard/types"
import type { ApiRolePermission } from "@/lib/api"

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export"
export type PermissionModule =
  | "patients"
  | "appointments"
  | "ward"
  | "pharmacy"
  | "lab"
  | "billing"
  | "queue"
  | "reports"

const permissions: Record<PermissionModule, Record<PermissionAction, Role[]>> = {
  patients: {
    view: ["admin", "billing_manager", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"],
    create: ["admin", "receptionist"], edit: ["admin", "receptionist"], delete: ["admin"], export: ["admin", "receptionist"],
  },
  appointments: {
    view: ["admin", "receptionist", "doctor", "nurse"], create: ["admin", "receptionist"], edit: ["admin", "receptionist"], delete: ["admin", "receptionist"], export: ["admin", "receptionist"],
  },
  ward: {
    view: ["admin", "billing_manager", "receptionist", "doctor", "nurse"], create: ["admin", "receptionist", "doctor"], edit: ["admin", "nurse"], delete: ["admin"], export: ["admin", "receptionist"],
  },
  pharmacy: {
    view: ["admin", "doctor", "pharmacist"], create: ["admin", "pharmacist"], edit: ["admin", "pharmacist"], delete: ["admin", "pharmacist"], export: ["admin", "pharmacist"],
  },
  lab: {
    view: ["admin", "doctor", "receptionist", "lab_technician", "pathologist", "nurse"], create: ["admin", "doctor", "receptionist"], edit: ["admin", "lab_technician"], delete: ["admin"], export: ["admin", "lab_technician"],
  },
  billing: {
    view: ["admin", "billing_manager", "receptionist"], create: ["admin", "billing_manager", "receptionist"], edit: ["admin", "billing_manager", "receptionist"], delete: ["admin", "billing_manager"], export: ["admin", "billing_manager", "receptionist"],
  },
  queue: {
    view: ["admin", "receptionist", "doctor", "nurse"], create: ["admin", "receptionist", "doctor", "nurse"], edit: ["admin", "receptionist", "doctor", "nurse"], delete: ["admin"], export: ["admin", "receptionist"],
  },
  reports: {
    view: ["admin"], create: ["admin"], edit: ["admin"], delete: ["admin"], export: ["admin"],
  },
}

const STORAGE_KEY = "careplus_stored_role_permissions"

let storedRolePermissions: ApiRolePermission[] = (() => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
})()

export function setStoredPermissions(items: ApiRolePermission[]): void {
  storedRolePermissions = items
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredPermissions(): ApiRolePermission[] {
  return storedRolePermissions
}

export function can(role: Role, module: PermissionModule, action: PermissionAction): boolean {
  const normalizedRole = role.toLowerCase()

  // Safeguard: Admin role always has full access
  if (normalizedRole === "admin") return true

  // Evaluate stored permissions if available
  if (storedRolePermissions && storedRolePermissions.length > 0) {
    const entry = storedRolePermissions.find(
      (p) =>
        p.role.toLowerCase() === normalizedRole &&
        p.module.toLowerCase() === module.toLowerCase()
    )
    if (entry) {
      return entry.allowedActions.includes(action)
    }
  }

  // Fall back to hard-coded baseline defaults
  return permissions[module]?.[action]?.includes(normalizedRole as Role) ?? false
}

export { permissions }
