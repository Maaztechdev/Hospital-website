import type { UltrasoundOrderStatus } from "@prisma/client";
import { ConflictError } from "@common/errors/AppError";

export const ultrasoundTransitions: Record<UltrasoundOrderStatus, UltrasoundOrderStatus[]> = {
  ORDERED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REPORTED", "CANCELLED"],
  REPORTED: ["VERIFIED"],
  VERIFIED: ["DELIVERED", "FINALIZED"],
  DELIVERED: [],
  FINALIZED: [],
  CANCELLED: [],
};

export function isUltrasoundTransitionAllowed(from: UltrasoundOrderStatus, to: UltrasoundOrderStatus): boolean {
  return ultrasoundTransitions[from].includes(to);
}

export function assertUltrasoundTransitionAllowed(from: UltrasoundOrderStatus, to: UltrasoundOrderStatus): void {
  if (!isUltrasoundTransitionAllowed(from, to)) {
    throw new ConflictError(`Cannot move ultrasound order from ${from} to ${to}`);
  }
}

export function assertAmendmentReason(status: UltrasoundOrderStatus, reason?: string): void {
  if (status === "VERIFIED" && !reason?.trim()) {
    throw new ConflictError("An amendment reason is required to edit a verified report");
  }
}
