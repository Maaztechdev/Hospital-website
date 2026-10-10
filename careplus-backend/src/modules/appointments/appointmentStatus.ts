export const APPOINTMENT_STATUSES = [
  "PENDING_APPROVAL",
  "CONFIRMED",
  "WAITING",
  "IN_CONSULTATION",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "EXPIRED",
] as const

export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number]

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_APPROVAL: "Pending Approval",
  CONFIRMED: "Confirmed",
  WAITING: "Waiting",
  IN_CONSULTATION: "In Consultation",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
  EXPIRED: "Expired",
}
