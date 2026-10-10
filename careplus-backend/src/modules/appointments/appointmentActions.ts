import { AppointmentStatus } from "@prisma/client";
import { BadRequestError } from "@common/errors/AppError";

export type AppointmentAction =
  | "APPROVE"
  | "REJECT"
  | "RESCHEDULE"
  | "CANCEL"
  | "COMPLETE"
  | "MARK_NO_SHOW"
  | "CALL_NEXT"
  | "START_CONSULTATION"
  | "REQUEUE";

const ALLOWED_ACTIONS: Record<AppointmentStatus, AppointmentAction[]> = {
  PENDING_APPROVAL: ["APPROVE", "REJECT"],
  CONFIRMED: ["RESCHEDULE", "CANCEL", "MARK_NO_SHOW", "CALL_NEXT"],
  WAITING: ["CANCEL", "MARK_NO_SHOW", "START_CONSULTATION", "REQUEUE"],
  IN_CONSULTATION: ["COMPLETE"],
  DONE: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function assertAppointmentActionAllowed(status: AppointmentStatus, action: AppointmentAction) {
  if (!ALLOWED_ACTIONS[status].includes(action)) {
    throw new BadRequestError(`Cannot ${action.toLowerCase().replaceAll("_", " ")} an appointment with status ${status}`);
  }
}