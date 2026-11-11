import type { Role } from "@prisma/client";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";
export type PermissionModule =
  | "patients"
  | "appointments"
  | "ward"
  | "pharmacy"
  | "lab"
  | "ultrasound"
  | "billing"
  | "queue"
  | "reports";

export const CONFIGURABLE_PERMISSION_PAIRS = new Set<string>([
  "ward:view",
  "ward:create",
  "ward:edit",
  "billing:view",
  "billing:create",
  "billing:edit",
  "reports:view",
  "patients:view",
  "patients:create",
  "patients:edit",
]);

export function isConfigurablePermission(module: string, action: string): boolean {
  return CONFIGURABLE_PERMISSION_PAIRS.has(`${module.toLowerCase()}:${action.toLowerCase()}`);
}

function tagPermission(module: PermissionModule, action: PermissionAction, roles: Role[]): Role[] {
  const arr = [...roles] as Role[] & { __module?: PermissionModule; __action?: PermissionAction };
  arr.__module = module;
  arr.__action = action;
  return arr;
}

export const permissions: Record<PermissionModule, Record<PermissionAction, Role[]>> = {
  patients: {
    view: tagPermission("patients", "view", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "PHARMACIST", "NURSE", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"]),
    create: tagPermission("patients", "create", ["ADMIN", "RECEPTIONIST"]),
    edit: tagPermission("patients", "edit", ["ADMIN", "RECEPTIONIST"]),
    delete: tagPermission("patients", "delete", ["ADMIN"]),
    export: tagPermission("patients", "export", ["ADMIN", "RECEPTIONIST"]),
  },
  appointments: {
    view: tagPermission("appointments", "view", ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]),
    create: tagPermission("appointments", "create", ["ADMIN", "RECEPTIONIST"]),
    edit: tagPermission("appointments", "edit", ["ADMIN", "RECEPTIONIST"]),
    delete: tagPermission("appointments", "delete", ["ADMIN", "RECEPTIONIST"]),
    export: tagPermission("appointments", "export", ["ADMIN", "RECEPTIONIST"]),
  },
  ward: {
    view: tagPermission("ward", "view", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]),
    create: tagPermission("ward", "create", ["ADMIN", "RECEPTIONIST", "DOCTOR"]),
    edit: tagPermission("ward", "edit", ["ADMIN", "NURSE"]),
    delete: tagPermission("ward", "delete", ["ADMIN"]),
    export: tagPermission("ward", "export", ["ADMIN", "RECEPTIONIST"]),
  },
  pharmacy: {
    view: tagPermission("pharmacy", "view", ["ADMIN", "PHARMACIST"]),
    create: tagPermission("pharmacy", "create", ["ADMIN", "PHARMACIST"]),
    edit: tagPermission("pharmacy", "edit", ["ADMIN", "PHARMACIST"]),
    delete: tagPermission("pharmacy", "delete", ["ADMIN", "PHARMACIST"]),
    export: tagPermission("pharmacy", "export", ["ADMIN", "PHARMACIST"]),
  },
  lab: {
    view: tagPermission("lab", "view", ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"]),
    create: tagPermission("lab", "create", ["ADMIN", "DOCTOR", "RECEPTIONIST"]),
    edit: tagPermission("lab", "edit", ["ADMIN", "LAB_TECHNICIAN"]),
    delete: tagPermission("lab", "delete", ["ADMIN"]),
    export: tagPermission("lab", "export", ["ADMIN", "LAB_TECHNICIAN"]),
  },
  ultrasound: {
    view: tagPermission("ultrasound", "view", ["ADMIN", "DOCTOR", "RECEPTIONIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"]),
    create: tagPermission("ultrasound", "create", ["DOCTOR", "RADIOLOGIST"]),
    edit: tagPermission("ultrasound", "edit", ["ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "DOCTOR", "RADIOLOGIST"]),
    delete: tagPermission("ultrasound", "delete", ["ADMIN", "RECEPTIONIST"]),
    export: tagPermission("ultrasound", "export", ["ADMIN", "RECEPTIONIST", "DOCTOR", "RADIOLOGIST"]),
  },
  billing: {
    view: tagPermission("billing", "view", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
    create: tagPermission("billing", "create", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
    edit: tagPermission("billing", "edit", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
    delete: tagPermission("billing", "delete", ["ADMIN", "BILLING_MANAGER"]),
    export: tagPermission("billing", "export", ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]),
  },
  queue: {
    view: tagPermission("queue", "view", ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]),
    create: tagPermission("queue", "create", ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]),
    edit: tagPermission("queue", "edit", ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"]),
    delete: tagPermission("queue", "delete", ["ADMIN"]),
    export: tagPermission("queue", "export", ["ADMIN", "RECEPTIONIST"]),
  },
  reports: {
    view: tagPermission("reports", "view", ["ADMIN"]),
    create: tagPermission("reports", "create", ["ADMIN"]),
    edit: tagPermission("reports", "edit", ["ADMIN"]),
    delete: tagPermission("reports", "delete", ["ADMIN"]),
    export: tagPermission("reports", "export", ["ADMIN"]),
  },
};
