import { BedStatus } from "@prisma/client";
import { ConflictError } from "@common/errors/AppError";

export function assertBedStatusTransitionAllowed(current: BedStatus, next: BedStatus): void {
  if (current === "OCCUPIED" && next === "AVAILABLE") {
    throw new ConflictError("Cannot mark an occupied bed as available — discharge the patient first");
  }
}
