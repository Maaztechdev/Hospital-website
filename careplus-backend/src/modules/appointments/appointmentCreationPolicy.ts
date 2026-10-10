import { AppointmentStatus, Role } from "@prisma/client";

export const APPOINTMENT_CREATION_POLICY = {
  publicPortal: "PENDING_APPROVAL",
  byRole: {
    ADMIN: "CONFIRMED",
    BILLING_MANAGER: "PENDING_APPROVAL",
    RECEPTIONIST: "CONFIRMED",
    DOCTOR: "PENDING_APPROVAL",
    LAB_TECHNICIAN: "PENDING_APPROVAL",
    PATHOLOGIST: "PENDING_APPROVAL",
    ULTRASOUND_TECH: "PENDING_APPROVAL",
    ULTRASOUND_TECHNICIAN: "PENDING_APPROVAL",
    RADIOLOGIST: "PENDING_APPROVAL",
    PHARMACIST: "PENDING_APPROVAL",
    NURSE: "PENDING_APPROVAL",
  } satisfies Record<Role, AppointmentStatus>,
} as const;

export function getAppointmentCreationStatus(role: Role): AppointmentStatus {
  return APPOINTMENT_CREATION_POLICY.byRole[role];
}

export function getPublicAppointmentCreationStatus(): AppointmentStatus {
  return APPOINTMENT_CREATION_POLICY.publicPortal;
}
