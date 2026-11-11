import type { LabOrderStatus } from "@prisma/client";

export type LabSampleStatusAction = "SAMPLE_COLLECTED" | "PROCESSING" | "CANCELLED";

export function canTransitionLabSampleStatus(current: LabOrderStatus, next: LabSampleStatusAction) {
  if (next === "SAMPLE_COLLECTED") return current === "ORDERED";
  if (next === "PROCESSING") return current === "SAMPLE_COLLECTED";
  return current === "ORDERED" || current === "SAMPLE_COLLECTED" || current === "PROCESSING";
}

export function canVerifyLabResult(enteredBy: string | null, verifiedBy: string, allowSameUser: boolean, isVerifierAdmin: boolean = false) {
  return allowSameUser || isVerifierAdmin || (enteredBy != null && enteredBy !== verifiedBy);
}

export function isLabPaymentSatisfied(requirePayment: boolean, balanceAmount: number) {
  return !requirePayment || balanceAmount <= 0;
}
