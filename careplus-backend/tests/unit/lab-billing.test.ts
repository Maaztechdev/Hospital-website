import { canVoidLabInvoice } from "../../src/modules/billing/billing.service";
import { recordPaymentSchema, listInvoicesQuerySchema } from "../../src/modules/billing/billing.validators";
import {
  createLabLedgerAccountSchema,
  createLabOrderSchema,
  createLabPackageOrderSchema,
  createLabTestSchema,
  labLedgerPaymentSchema,
} from "../../src/modules/lab/lab.validators";
import { isLabPaymentSatisfied } from "../../src/modules/lab/lab.workflowUtils";
import { canExposePatientBalance } from "../../src/modules/patients/patients.service";

const patientId = "d9428888-f536-4b21-bb00-fd3c6d0438d8";
const testId = "c8ff975d-8515-4382-85a8-c8a85ac197fb";
const packageId = "77fd84c4-5932-456f-b10d-083c70cb655e";

describe("Lab billing API validation and policies", () => {
  it("requires a reason for every non-zero discount on a single test order", () => {
    const order = { patientId, testId, discountPercent: 5 };
    expect(createLabOrderSchema.safeParse(order).success).toBe(false);
    expect(createLabOrderSchema.safeParse({ ...order, discountReason: "Financial hardship" }).success).toBe(true);
  });

  it("accepts package orders without a test id and validates their discount reason", () => {
    const order = { patientId, packageId, discountPercent: 5 };
    expect(createLabPackageOrderSchema.safeParse(order).success).toBe(false);
    expect(createLabPackageOrderSchema.safeParse({ ...order, discountReason: "Approved assistance" }).success).toBe(true);
    expect(createLabPackageOrderSchema.safeParse({ patientId, packageId }).success).toBe(true);
  });

  it("accepts online payments and filters invoice searches to Lab items", () => {
    expect(recordPaymentSchema.safeParse({ paymentMethod: "ONLINE", amount: 100 }).success).toBe(true);
    expect(listInvoicesQuerySchema.safeParse({ search: "LAB-2026-000123", itemType: "LAB", status: "UNPAID" }).success).toBe(true);
  });

  it("requires a cleared balance before collection only when configured", () => {
    expect(isLabPaymentSatisfied(false, 500)).toBe(true);
    expect(isLabPaymentSatisfied(true, 0)).toBe(true);
    expect(isLabPaymentSatisfied(true, 1)).toBe(false);
  });

  it("restricts Lab invoice cancellation to Admin while preserving existing non-Lab roles", () => {
    expect(canVoidLabInvoice("ADMIN", true)).toBe(true);
    expect(canVoidLabInvoice("BILLING_MANAGER", true)).toBe(false);
    expect(canVoidLabInvoice("BILLING_MANAGER", false)).toBe(true);
  });

  it("does not expose patient balances to Lab Technicians", () => {
    expect(canExposePatientBalance("LAB_TECHNICIAN")).toBe(false);
    expect(canExposePatientBalance("ADMIN")).toBe(true);
  });

  it("requires a clinic ledger account to be a valid UUID when attached to an order", () => {
    expect(createLabOrderSchema.safeParse({ patientId, testId, referringClinicAccountId: "clinic-1" }).success).toBe(false);
    expect(createLabOrderSchema.safeParse({ patientId, testId, referringClinicAccountId: packageId }).success).toBe(true);
  });

  it("requires send-out tests to specify a reference lab and outsourced cost", () => {
    const test = { testName: "Reference assay", testCode: "REF1", price: 100 };
    expect(createLabTestSchema.safeParse({ ...test, isSendOut: true }).success).toBe(false);
    expect(createLabTestSchema.safeParse({
      ...test,
      isSendOut: true,
      referenceLabSupplierId: packageId,
      sendOutCost: 35,
    }).success).toBe(true);
  });

  it("validates ledger party creation and payment method/amount", () => {
    expect(createLabLedgerAccountSchema.safeParse({ partyType: "CLINIC", partyName: "North Clinic" }).success).toBe(true);
    expect(createLabLedgerAccountSchema.safeParse({ partyType: "PATIENT", partyName: "Patient" }).success).toBe(false);
    expect(labLedgerPaymentSchema.safeParse({ amount: 10, paymentMethod: "CASH" }).success).toBe(true);
    expect(labLedgerPaymentSchema.safeParse({ amount: 0, paymentMethod: "CASH" }).success).toBe(false);
  });
});
