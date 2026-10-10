import type { Role } from "@/dashboard/types"

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export"
export type PermissionModule = "patients" | "appointments" | "ward" | "pharmacy" | "lab" | "billing" | "queue"

const permissions: Record<PermissionModule, Record<PermissionAction, Role[]>> = {
  patients: {
    view: ["admin", "receptionist", "doctor", "lab_technician", "pharmacist", "nurse", "ultrasound_tech", "ultrasound_technician", "radiologist"],
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
}

export function can(role: Role, module: PermissionModule, action: PermissionAction): boolean {
  return permissions[module][action].includes(role)
}

export { permissions }
