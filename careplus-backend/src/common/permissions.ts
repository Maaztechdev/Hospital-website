import type { Role } from "@prisma/client";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";
export type PermissionModule = "patients" | "appointments" | "ward" | "pharmacy" | "lab" | "billing" | "queue";

export const permissions: Record<PermissionModule, Record<PermissionAction, Role[]>> = {
  patients: {
    view: ["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "PHARMACIST", "NURSE", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"],
    create: ["ADMIN", "RECEPTIONIST"], edit: ["ADMIN", "RECEPTIONIST"], delete: ["ADMIN"], export: ["ADMIN", "RECEPTIONIST"],
  },
  appointments: {
    view: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"], create: ["ADMIN", "RECEPTIONIST"], edit: ["ADMIN", "RECEPTIONIST"], delete: ["ADMIN", "RECEPTIONIST"], export: ["ADMIN", "RECEPTIONIST"],
  },
  ward: {
    view: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"], create: ["ADMIN", "RECEPTIONIST", "DOCTOR"], edit: ["ADMIN", "NURSE"], delete: ["ADMIN"], export: ["ADMIN", "RECEPTIONIST"],
  },
  pharmacy: {
    view: ["ADMIN", "PHARMACIST"], create: ["ADMIN", "PHARMACIST"], edit: ["ADMIN", "PHARMACIST"], delete: ["ADMIN", "PHARMACIST"], export: ["ADMIN", "PHARMACIST"],
  },
  lab: {
    view: ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"], create: ["ADMIN", "DOCTOR", "RECEPTIONIST"], edit: ["ADMIN", "LAB_TECHNICIAN"], delete: ["ADMIN"], export: ["ADMIN", "LAB_TECHNICIAN"],
  },
  billing: {
    view: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"], create: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"], edit: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"], delete: ["ADMIN", "BILLING_MANAGER"], export: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"],
  },
  queue: {
    view: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"], create: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"], edit: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"], delete: ["ADMIN"], export: ["ADMIN", "RECEPTIONIST"],
  },
};
