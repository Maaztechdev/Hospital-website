import { LabOrderEventType, LabOrderStatus, Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyRoles, notifyUser } from "@common/utils/notify";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";
import { generateLabOrderNumber } from "@common/utils/sequenceGenerators";
import { createLabInvoiceInTransaction } from "@modules/billing/billing.service";
import { getApprovingAdminId, getCashierDiscountLimit } from "@modules/pharmacy/pharmacy.service";
import { labSettingsSchema } from "./lab.validators";
import type { createLabOrderSchema, createLabPackageOrderSchema, createLabTestSchema, labPackageSchema } from "./lab.validators";
import { applyLabCriticalThresholdDefaults, formatLabReferenceRange, interpretLabValue, resolveLabReferenceRange, type LabParameterInterpretation } from "./lab.resultUtils";
import { canTransitionLabSampleStatus, canVerifyLabResult, isLabPaymentSatisfied } from "./lab.workflowUtils";
import { consumeLabInventory } from "./labInventory.service";
import { appendLabLedgerEntry } from "./labLedger.service";

type LabTestInput = typeof createLabTestSchema._type;
type LabPackageInput = typeof labPackageSchema._type;
type LabOrderBillingInput = {
  patientId: string;
  doctorId?: string;
  testId?: string;
  packageId?: string;
  priority?: string;
  sampleType?: string;
  clinicalNotes?: string;
  consultationId?: string;
  discountPercent?: number;
  discountReason?: string;
  referringClinicAccountId?: string;
};
type LabResultInput = {
  parameters?: Array<{ parameterId: string; value: string; overriddenInterpretation?: LabParameterInterpretation; overrideReason?: string }>;
  resultValue?: string;
  unit?: string;
  referenceRange?: string;
  interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL";
  technicianNotes?: string;
  reportRemarks?: string;
  amendmentReason?: string;
  inventoryOverrideReason?: string;
};

const LAB_SAME_USER_VERIFICATION_SETTING = "lab.allow_same_user_enter_verify";
const LAB_REPORT_SETTINGS_KEY = "lab.report_settings";
const LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING = "lab.require_payment_before_collection";
const LAB_DEFAULT_TURNAROUND_SETTING = "lab.default_turnaround_hours";
const LAB_MAX_DISCOUNT_SETTING = "lab.max_discount_percent";
const LAB_CRITICAL_THRESHOLD_DEFAULTS_SETTING = "lab.critical_threshold_defaults";

async function requirePaymentBeforeCollection(tx?: Prisma.TransactionClient): Promise<boolean> {
  const setting = await (tx ?? prisma).setting.findUnique({
    where: { key: LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING },
  });
  const value = setting?.value ?? false;
  if (typeof value !== "boolean") {
    throw new BadRequestError("The Lab payment-before-collection setting is invalid.");
  }
  return value;
}

async function ensureLabPaymentBeforeCollection(tx: Prisma.TransactionClient, orderId: string) {
  const required = await requirePaymentBeforeCollection(tx);
  const order = await tx.labOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { invoice: { select: { balanceAmount: true } } },
  });
  if (required && !order.invoice) {
    throw new ConflictError("Payment is required before sample collection, but this order has no linked invoice. Ask billing staff to review it.");
  }
  if (order.invoice && !isLabPaymentSatisfied(required, Number(order.invoice.balanceAmount))) {
    throw new ConflictError("Payment is required before sample collection. Receive the outstanding invoice balance first.");
  }
}

export type LabReportSettings = {
  logoUrl?: string;
  labName: string;
  address?: string;
  phone?: string;
  accreditationLine?: string;
  headerText?: string;
  footerText?: string;
  pathologistName?: string;
  pathologistSignatureUrl?: string;
  technicianName?: string;
  technicianSignatureUrl?: string;
  reportsRetentionNote?: string;
};

type LabCriticalThresholdDefault = {
  criticalLow?: number | null;
  criticalHigh?: number | null;
};

type LabSettingsInput = typeof labSettingsSchema._type;

const DEFAULT_LAB_TURNAROUND_HOURS = 24;
const DEFAULT_REPORT_RETENTION_NOTE = "Lab report versions are retained in the order history. Follow the hospital's records-retention policy.";

function settingObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("The Lab report settings are invalid.");
  return value as Record<string, Prisma.JsonValue>;
}

function numberSetting(value: Prisma.JsonValue | null | undefined, fallback: number, label: string) {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestError(`The Lab ${label} setting is invalid.`);
  }
  return value;
}

function percentageSetting(value: Prisma.JsonValue | null | undefined, fallback: number, label: string) {
  const percentage = numberSetting(value, fallback, label);
  if (percentage < 0 || percentage > 100) throw new BadRequestError(`The Lab ${label} setting must be between 0 and 100.`);
  return percentage;
}

function parseTurnaroundSetting(value: Prisma.JsonValue | null | undefined) {
  const hours = numberSetting(value, DEFAULT_LAB_TURNAROUND_HOURS, "default turnaround time");
  if (!Number.isInteger(hours) || hours < 0 || hours > 8760) {
    throw new BadRequestError("The Lab default turnaround time must be a whole number from 0 to 8760.");
  }
  return hours;
}

function booleanSetting(value: Prisma.JsonValue | null | undefined, fallback = false, label = "setting") {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new BadRequestError(`The Lab ${label} setting is invalid.`);
  return value;
}

async function readSetting(key: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.setting.findUnique({ where: { key }, select: { value: true } });
}

async function labDiscountLimit(tx: Prisma.TransactionClient) {
  const setting = await readSetting(LAB_MAX_DISCOUNT_SETTING, tx);
  if (setting?.value != null) return percentageSetting(setting.value, 10, "maximum discount percentage");
  return getCashierDiscountLimit(tx);
}

async function readCriticalThresholdDefaults(tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const setting = await readSetting(LAB_CRITICAL_THRESHOLD_DEFAULTS_SETTING, tx);
  const parsed = labSettingsSchema.shape.criticalThresholdDefaults.safeParse(setting?.value ?? {});
  if (!parsed.success) throw new BadRequestError("The Lab critical threshold defaults setting is invalid.");
  return parsed.data as Record<string, LabCriticalThresholdDefault>;
}

async function writeLabOrderEvent(
  tx: Prisma.TransactionClient,
  input: {
    labOrderId: string;
    actorId: string;
    eventType: LabOrderEventType;
    oldValues?: Prisma.InputJsonValue;
    newValues?: Prisma.InputJsonValue;
  },
) {
  return tx.labOrderEvent.create({
    data: {
      labOrderId: input.labOrderId,
      actorId: input.actorId,
      eventType: input.eventType,
      oldValues: input.oldValues,
      newValues: input.newValues,
    },
  });
}

async function createBilledLabOrders(
  actor: AccessTokenPayload,
  input: LabOrderBillingInput,
  req?: Request,
) {
  const actorDoctorId = await getActorDoctorId(actor);
  let doctorId = actorDoctorId ?? input.doctorId;
  if (!doctorId && input.consultationId) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: input.consultationId },
      select: { doctorId: true },
    });
    doctorId = consultation?.doctorId;
  }

  const discountPercent = input.discountPercent ?? 0;
  const result = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });
    if (!patient) throw new NotFoundError("Patient not found");

    const selectedPackage = input.packageId
      ? await tx.labPackage.findFirst({
        where: { id: input.packageId, isActive: true },
        include: {
          tests: {
            where: { isActive: true },
            orderBy: { displayOrder: "asc" },
            include: { test: true },
          },
        },
      })
      : null;
    if (input.packageId && !selectedPackage) throw new NotFoundError("Active Lab package not found");

    const selectedTest = !selectedPackage && input.testId
      ? await tx.labTest.findFirst({ where: { id: input.testId, isActive: true } })
      : null;
    const selectedTests = selectedPackage
      ? selectedPackage.tests.filter((item) => item.test.isActive).map((item) => item.test)
      : selectedTest ? [selectedTest] : [];
    if (selectedTests.length === 0) {
      throw new BadRequestError(selectedPackage ? "The selected Lab package has no active tests" : "Active Lab test not found");
    }
    if (!selectedPackage && !selectedTest) throw new NotFoundError("Active Lab test not found");
    const clinicAccount = input.referringClinicAccountId
      ? await tx.labLedgerAccount.findFirst({
        where: { id: input.referringClinicAccountId, type: "RECEIVABLE", partyType: "CLINIC" },
      })
      : null;
    if (input.referringClinicAccountId && !clinicAccount) {
      throw new BadRequestError("Select a valid referring clinic account.");
    }

    let discountApprovedBy: string | undefined;
    if (discountPercent > 0) {
      if (!input.discountReason?.trim()) throw new BadRequestError("A reason is required for a Lab discount");
      const discountLimit = await labDiscountLimit(tx);
      if (discountPercent > discountLimit) {
        discountApprovedBy = actor.role === "ADMIN"
          ? actor.sub
          : await getApprovingAdminId(req?.get("X-Discount-Approval-Token"), req?.get("X-Discount-Approval-Pin"));
      }
    }

    const price = Number(selectedPackage?.price ?? selectedTests[0].price);
    const invoice = await createLabInvoiceInTransaction(tx, {
      patientId: input.patientId,
      description: selectedPackage ? `Lab package: ${selectedPackage.name}` : selectedTests[0].testName,
      unitPrice: price,
      discountPercent,
      discountReason: input.discountReason?.trim(),
      discountAppliedBy: discountPercent > 0 ? actor.sub : undefined,
      discountApprovedBy,
      labPackageId: selectedPackage?.id,
      createdBy: actor.sub,
    });
    const receivableAccount = clinicAccount ?? await tx.labLedgerAccount.upsert({
      where: { patientId: patient.id },
      create: {
        type: "RECEIVABLE",
        partyType: "PATIENT",
        patientId: patient.id,
        partyName: `${patient.firstName} ${patient.lastName}`.trim(),
        partyPhone: patient.phone,
        createdBy: actor.sub,
      },
      update: {},
    });
    if (Number(invoice.balanceAmount) > 0) {
      await appendLabLedgerEntry(tx, {
        accountId: receivableAccount.id,
        type: "INVOICE_CHARGE",
        amount: Number(invoice.balanceAmount),
        invoiceId: invoice.id,
        notes: `Lab invoice ${invoice.invoiceNumber}`,
        createdBy: actor.sub,
      });
    }
    const orders = [];
    for (const test of selectedTests) {
      const created = await tx.labOrder.create({
        data: {
          orderNumber: await generateLabOrderNumber(tx),
          patientId: input.patientId,
          doctorId,
          testId: test.id,
          priority: (input.priority as never) ?? "ROUTINE",
          sampleType: input.sampleType ?? test.sampleType ?? undefined,
          clinicalNotes: input.clinicalNotes,
          createdBy: actor.sub,
          consultationId: input.consultationId,
          invoiceId: invoice.id,
          referringClinicAccountId: clinicAccount?.id,
        },
      });
      if (test.isSendOut) {
        if (!test.referenceLabSupplierId || test.sendOutCost == null) {
          throw new BadRequestError(`Send-out test "${test.testName}" is missing its reference lab or outsourced cost.`);
        }
        const supplier = await tx.supplier.findUnique({ where: { id: test.referenceLabSupplierId } });
        if (!supplier) throw new BadRequestError(`The reference lab for "${test.testName}" no longer exists.`);
        const payableAccount = await tx.labLedgerAccount.upsert({
          where: { supplierId: supplier.id },
          create: {
            type: "PAYABLE",
            partyType: "REFERENCE_LAB",
            supplierId: supplier.id,
            partyName: supplier.name,
            partyPhone: supplier.phone,
            createdBy: actor.sub,
          },
          update: {},
        });
        if (Number(test.sendOutCost) > 0) {
          await appendLabLedgerEntry(tx, {
            accountId: payableAccount.id,
            type: "SEND_OUT_CHARGE",
            amount: Number(test.sendOutCost),
            labOrderId: created.id,
            notes: `Send-out cost for ${created.orderNumber}`,
            createdBy: actor.sub,
          });
        }
      }
      await writeLabOrderEvent(tx, {
        labOrderId: created.id,
        actorId: actor.sub,
        eventType: "ORDERED",
        newValues: { status: created.status, orderNumber: created.orderNumber, testId: created.testId, invoiceId: invoice.id },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "CREATE",
        module: "lab",
        entityType: "LabOrder",
        entityId: created.id,
        newValues: created,
        req,
      }, tx);
      orders.push(created);
    }
    await writeAuditLog({
      userId: actor.sub,
      action: "CREATE",
      module: "billing",
      entityType: "Invoice",
      entityId: invoice.id,
      newValues: invoice,
      req,
    }, tx);
    return { orders, invoice };
  });
  return result;
}

function resultAuditSnapshot(result: {
  id: string;
  resultValue: string;
  unit: string | null;
  referenceRange: string | null;
  interpretation: string | null;
  technicianNotes: string | null;
  reportRemarks: string | null;
  amendmentReason: string | null;
  amendedAt: Date | null;
  parameters: Array<{
    parameterName: string;
    value: string;
    unit: string | null;
    referenceRange: string | null;
    computedInterpretation: string | null;
    overriddenInterpretation: string | null;
    overrideReason: string | null;
  }>;
}) {
  return {
    id: result.id,
    resultValue: result.resultValue,
    unit: result.unit,
    referenceRange: result.referenceRange,
    interpretation: result.interpretation,
    technicianNotes: result.technicianNotes,
    reportRemarks: result.reportRemarks,
    amendmentReason: result.amendmentReason,
    amendedAt: result.amendedAt?.toISOString() ?? null,
    parameters: result.parameters,
  };
}

export const labService = {
  async getReportSettings() {
    const [reportSetting, criticalThresholdDefaults] = await Promise.all([
      readSetting(LAB_REPORT_SETTINGS_KEY),
      readCriticalThresholdDefaults(),
    ]);
    const reportValue = settingObject(reportSetting?.value);
    return {
      labName: typeof reportValue.labName === "string" ? reportValue.labName : "",
      logoUrl: typeof reportValue.logoUrl === "string" ? reportValue.logoUrl : "",
      address: typeof reportValue.address === "string" ? reportValue.address : "",
      phone: typeof reportValue.phone === "string" ? reportValue.phone : "",
      accreditationLine: typeof reportValue.accreditationLine === "string" ? reportValue.accreditationLine : "",
      headerText: typeof reportValue.headerText === "string" ? reportValue.headerText : "",
      footerText: typeof reportValue.footerText === "string" ? reportValue.footerText : "",
      pathologistName: typeof reportValue.pathologistName === "string" ? reportValue.pathologistName : "",
      pathologistSignatureUrl: typeof reportValue.pathologistSignatureUrl === "string" ? reportValue.pathologistSignatureUrl : "",
      technicianName: typeof reportValue.technicianName === "string" ? reportValue.technicianName : "",
      technicianSignatureUrl: typeof reportValue.technicianSignatureUrl === "string" ? reportValue.technicianSignatureUrl : "",
      reportsRetentionNote: typeof reportValue.reportsRetentionNote === "string" ? reportValue.reportsRetentionNote : DEFAULT_REPORT_RETENTION_NOTE,
      criticalThresholdDefaults,
    };
  },

  async setReportSettings(actor: AccessTokenPayload, value: LabReportSettings, req?: Request) {
    const existing = await prisma.setting.findUnique({ where: { key: LAB_REPORT_SETTINGS_KEY } });
    const updated = await prisma.setting.upsert({
      where: { key: LAB_REPORT_SETTINGS_KEY },
      create: { key: LAB_REPORT_SETTINGS_KEY, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "lab",
      entityType: "LabReportSettings",
      entityId: LAB_REPORT_SETTINGS_KEY,
      oldValues: existing?.value,
      newValues: updated.value,
      req,
    });
    return updated.value as LabReportSettings;
  },

  async getLabSettings() {
    const [reportSetting, verificationSetting, billingSetting, turnaroundSetting, discountSetting, cashierDiscountSetting, thresholdSetting, backup] = await Promise.all([
      readSetting(LAB_REPORT_SETTINGS_KEY),
      readSetting(LAB_SAME_USER_VERIFICATION_SETTING),
      readSetting(LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING),
      readSetting(LAB_DEFAULT_TURNAROUND_SETTING),
      readSetting(LAB_MAX_DISCOUNT_SETTING),
      readSetting("cashierMaxDiscountPercent"),
      readSetting(LAB_CRITICAL_THRESHOLD_DEFAULTS_SETTING),
      prisma.backup.findFirst({ where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const reportValue = settingObject(reportSetting?.value);
    const rawThresholds = thresholdSetting?.value ?? {};
    const parsedThresholds = labSettingsSchema.shape.criticalThresholdDefaults.safeParse(rawThresholds);
    if (!parsedThresholds.success) throw new BadRequestError("The Lab critical threshold defaults setting is invalid.");
    const cashierDiscountFallback = percentageSetting(cashierDiscountSetting?.value, 10, "cashier discount percentage");
    const maxDiscountPercent = percentageSetting(discountSetting?.value, cashierDiscountFallback, "maximum discount percentage");
    const defaultTurnaroundHours = parseTurnaroundSetting(turnaroundSetting?.value);

    return {
      labName: typeof reportValue.labName === "string" ? reportValue.labName : "",
      logoUrl: typeof reportValue.logoUrl === "string" ? reportValue.logoUrl : "",
      address: typeof reportValue.address === "string" ? reportValue.address : "",
      phone: typeof reportValue.phone === "string" ? reportValue.phone : "",
      accreditationLine: typeof reportValue.accreditationLine === "string" ? reportValue.accreditationLine : "",
      headerText: typeof reportValue.headerText === "string" ? reportValue.headerText : "",
      footerText: typeof reportValue.footerText === "string" ? reportValue.footerText : "",
      pathologistName: typeof reportValue.pathologistName === "string" ? reportValue.pathologistName : "",
      pathologistSignatureUrl: typeof reportValue.pathologistSignatureUrl === "string" ? reportValue.pathologistSignatureUrl : "",
      technicianName: typeof reportValue.technicianName === "string" ? reportValue.technicianName : "",
      technicianSignatureUrl: typeof reportValue.technicianSignatureUrl === "string" ? reportValue.technicianSignatureUrl : "",
      reportsRetentionNote: typeof reportValue.reportsRetentionNote === "string" ? reportValue.reportsRetentionNote : DEFAULT_REPORT_RETENTION_NOTE,
      criticalThresholdDefaults: parsedThresholds.data,
      allowSameUserEnterVerify: booleanSetting(verificationSetting?.value, false, "same-user verification"),
      requirePaymentBeforeCollection: booleanSetting(billingSetting?.value, false, "payment-before-collection"),
      defaultTurnaroundHours,
      maxDiscountPercent,
      lastBackupAt: backup?.createdAt.toISOString() ?? null,
    };
  },

  async setLabSettings(actor: AccessTokenPayload, input: LabSettingsInput, req?: Request) {
    const parameterIds = Object.keys(input.criticalThresholdDefaults);
    if (parameterIds.length) {
      const parameters = await prisma.labTestParameter.findMany({
        where: { id: { in: parameterIds } },
        select: { id: true, resultType: true },
      });
      if (parameters.length !== parameterIds.length || parameters.some((parameter) => parameter.resultType !== "NUMERIC")) {
        throw new BadRequestError("Critical threshold defaults must reference existing numeric Lab parameters.");
      }
    }
    const previous = await this.getLabSettings();
    const reportSettings: LabReportSettings = {
      labName: input.labName.trim(),
      logoUrl: input.logoUrl ?? "",
      address: input.address ?? "",
      phone: input.phone ?? "",
      accreditationLine: input.accreditationLine ?? "",
      headerText: input.headerText ?? "",
      footerText: input.footerText ?? "",
      pathologistName: input.pathologistName ?? "",
      pathologistSignatureUrl: input.pathologistSignatureUrl ?? "",
      technicianName: input.technicianName ?? "",
      technicianSignatureUrl: input.technicianSignatureUrl ?? "",
      reportsRetentionNote: input.reportsRetentionNote?.trim() || DEFAULT_REPORT_RETENTION_NOTE,
    };

    await prisma.$transaction(async (tx) => {
      const settingValues: Array<[string, Prisma.InputJsonValue]> = [
        [LAB_REPORT_SETTINGS_KEY, reportSettings as Prisma.InputJsonValue],
        [LAB_SAME_USER_VERIFICATION_SETTING, input.allowSameUserEnterVerify],
        [LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING, input.requirePaymentBeforeCollection],
        [LAB_DEFAULT_TURNAROUND_SETTING, input.defaultTurnaroundHours],
        [LAB_MAX_DISCOUNT_SETTING, input.maxDiscountPercent],
        [LAB_CRITICAL_THRESHOLD_DEFAULTS_SETTING, input.criticalThresholdDefaults as Prisma.InputJsonValue],
      ];
      for (const [key, value] of settingValues) {
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
      await writeAuditLog({
        userId: actor.sub,
        action: "UPDATE",
        module: "lab",
        entityType: "LabSettings",
        entityId: "lab.settings",
        oldValues: previous as Prisma.InputJsonValue,
        newValues: { ...input, ...reportSettings } as Prisma.InputJsonValue,
        req,
      }, tx);
    });
    return this.getLabSettings();
  },

  async getLabOrderPolicy() {
    const [discountSetting, cashierDiscountSetting, turnaroundSetting] = await Promise.all([
      readSetting(LAB_MAX_DISCOUNT_SETTING),
      readSetting("cashierMaxDiscountPercent"),
      readSetting(LAB_DEFAULT_TURNAROUND_SETTING),
    ]);
    return {
      maxDiscountPercent: percentageSetting(
        discountSetting?.value,
        percentageSetting(cashierDiscountSetting?.value, 10, "cashier discount percentage"),
        "maximum discount percentage",
      ),
      defaultTurnaroundHours: parseTurnaroundSetting(turnaroundSetting?.value),
    };
  },

  async verifyPublicReport(orderNumber: string) {
    const order = await prisma.labOrder.findUnique({
      where: { orderNumber },
      select: {
        orderNumber: true,
        status: true,
        results: { where: { supersededById: null }, select: { amendedAt: true } },
      },
    });
    return {
      isAuthentic: order?.status === "VERIFIED" && order.results.length > 0,
      reportNumber: order?.orderNumber ?? orderNumber,
      amended: Boolean(order?.results[0]?.amendedAt),
    };
  },

  async getVerificationSetting() {
    const setting = await prisma.setting.findUnique({ where: { key: LAB_SAME_USER_VERIFICATION_SETTING } });
    return { allowSameUserEnterVerify: setting?.value === true };
  },

  async setVerificationSetting(actor: AccessTokenPayload, allowSameUserEnterVerify: boolean, req?: Request) {
    const existing = await prisma.setting.findUnique({ where: { key: LAB_SAME_USER_VERIFICATION_SETTING } });
    const updated = await prisma.setting.upsert({
      where: { key: LAB_SAME_USER_VERIFICATION_SETTING },
      create: { key: LAB_SAME_USER_VERIFICATION_SETTING, value: allowSameUserEnterVerify },
      update: { value: allowSameUserEnterVerify },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "lab",
      entityType: "LabVerificationSetting",
      entityId: LAB_SAME_USER_VERIFICATION_SETTING,
      oldValues: existing?.value,
      newValues: updated.value,
      req,
    });
    return { allowSameUserEnterVerify: updated.value === true };
  },

  async getBillingSettings() {
    return { requirePaymentBeforeCollection: await requirePaymentBeforeCollection() };
  },

  async setBillingSettings(actor: AccessTokenPayload, requirePaymentBeforeCollectionValue: boolean, req?: Request) {
    const existing = await prisma.setting.findUnique({ where: { key: LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING } });
    const updated = await prisma.setting.upsert({
      where: { key: LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING },
      create: { key: LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING, value: requirePaymentBeforeCollectionValue },
      update: { value: requirePaymentBeforeCollectionValue },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "lab",
      entityType: "LabBillingSetting",
      entityId: LAB_REQUIRE_PAYMENT_BEFORE_COLLECTION_SETTING,
      oldValues: existing?.value ?? false,
      newValues: updated.value,
      req,
    });
    return { requirePaymentBeforeCollection: updated.value === true };
  },

  async listTests(includeInactive = false) {
    return prisma.labTest.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        referenceLabSupplier: { select: { id: true, name: true, phone: true } },
        parameters: {
          where: { isActive: true },
          orderBy: { displayOrder: "asc" },
          include: { ranges: { where: { isActive: true }, orderBy: { ageMinDays: "asc" } } },
        },
      },
      orderBy: [
        { isActive: "desc" },
        { testName: "asc" },
      ],
    });
  },

  async createTest(actor: AccessTokenPayload, input: LabTestInput, req?: Request) {
    const { parameters, ...testFields } = input;
    const turnaroundSetting = await readSetting(LAB_DEFAULT_TURNAROUND_SETTING);
    const defaultTurnaroundHours = parseTurnaroundSetting(turnaroundSetting?.value);
    const test = await prisma.labTest.create({
      data: {
        ...testFields,
        turnaroundTimeHours: input.turnaroundTimeHours ?? defaultTurnaroundHours,
        isActive: input.isActive ?? true,
        ...(parameters ? {
          parameters: {
            create: parameters.map(({ id: _id, ranges, ...parameter }) => ({
              ...parameter,
              ranges: { create: ranges.map(({ id: _rangeId, ...range }) => range) },
            })),
          },
        } : {}),
      },
      include: {
        referenceLabSupplier: { select: { id: true, name: true, phone: true } },
        parameters: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { ranges: { where: { isActive: true } } } },
      },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabTest", entityId: test.id, newValues: test, req });
    return test;
  },

  async updateTest(actor: AccessTokenPayload, id: string, input: LabTestInput, req?: Request) {
    const existing = await prisma.labTest.findUnique({
      where: { id },
      include: {
        referenceLabSupplier: { select: { id: true, name: true, phone: true } },
        parameters: { include: { ranges: true } },
      },
    });
    if (!existing) throw new NotFoundError("Lab test not found");

    const { parameters, ...testFields } = input;
    const turnaroundSetting = await readSetting(LAB_DEFAULT_TURNAROUND_SETTING);
    const defaultTurnaroundHours = parseTurnaroundSetting(turnaroundSetting?.value);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.labTest.update({
        where: { id },
        data: {
          ...testFields,
          ...(existing.turnaroundTimeHours == null && input.turnaroundTimeHours == null ? { turnaroundTimeHours: defaultTurnaroundHours } : {}),
          isActive: input.isActive ?? existing.isActive,
        },
      });
      if (parameters) {
        const resolvedParameterIds: string[] = [];
        for (const [displayOrder, parameter] of parameters.entries()) {
          const current = parameter.id
            ? existing.parameters.find((item) => item.id === parameter.id)
            : existing.parameters.find((item) => item.name === parameter.name);
          if (parameter.id && !current) throw new BadRequestError("A parameter does not belong to this test");
          if (current) {
            resolvedParameterIds.push(current.id);
            await tx.labTestParameter.update({
              where: { id: current.id },
              data: {
                name: parameter.name,
                unit: parameter.unit,
                displayOrder: parameter.displayOrder ?? displayOrder,
                resultType: parameter.resultType,
                decimalPlaces: parameter.decimalPlaces,
                isActive: true,
              },
            });
            const retainedRangeIds: string[] = [];
            for (const range of parameter.ranges) {
              const currentRange = range.id ? current.ranges.find((item) => item.id === range.id) : undefined;
              if (range.id && !currentRange) throw new BadRequestError("A reference range does not belong to this parameter");
              if (currentRange) retainedRangeIds.push(currentRange.id);
              const { id: _rangeId, ...rangeData } = range;
              if (currentRange) {
                await tx.labReferenceRange.update({ where: { id: currentRange.id }, data: { ...rangeData, isActive: true } });
              } else {
                await tx.labReferenceRange.create({ data: { ...rangeData, parameterId: current.id } });
              }
            }
            await tx.labReferenceRange.updateMany({
              where: { parameterId: current.id, ...(retainedRangeIds.length ? { id: { notIn: retainedRangeIds } } : {}) },
              data: { isActive: false },
            });
          } else {
            const created = await tx.labTestParameter.create({
              data: {
                testId: id,
                name: parameter.name,
                unit: parameter.unit,
                displayOrder: parameter.displayOrder ?? displayOrder,
                resultType: parameter.resultType,
                decimalPlaces: parameter.decimalPlaces,
                ranges: { create: parameter.ranges.map(({ id: _rangeId, ...range }) => range) },
              },
            });
            resolvedParameterIds.push(created.id);
          }
        }
        await tx.labTestParameter.updateMany({
          where: { testId: id, ...(resolvedParameterIds.length ? { id: { notIn: resolvedParameterIds } } : {}) },
          data: { isActive: false },
        });
        const inactiveParameters = existing.parameters.filter((parameter) => !resolvedParameterIds.includes(parameter.id));
        if (inactiveParameters.length) {
          await tx.labReferenceRange.updateMany({
            where: { parameterId: { in: inactiveParameters.map((parameter) => parameter.id) } },
            data: { isActive: false },
          });
        }
      }
      return tx.labTest.findUniqueOrThrow({
        where: { id },
        include: {
          referenceLabSupplier: { select: { id: true, name: true, phone: true } },
          parameters: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { ranges: { where: { isActive: true } } } },
        },
      });
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab", entityType: "LabTest", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async deleteTest(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.labTest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Lab test not found");

    const archived = await prisma.labTest.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "lab", entityType: "LabTest", entityId: id, oldValues: existing, newValues: archived, req });
    return archived;
  },

  async listPackages(includeInactive = false) {
    return prisma.labPackage.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        tests: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { test: true } },
      },
      orderBy: { name: "asc" },
    });
  },

  async createPackage(actor: AccessTokenPayload, input: LabPackageInput, req?: Request) {
    const availableTests = await prisma.labTest.count({ where: { id: { in: input.testIds }, isActive: true } });
    if (availableTests !== input.testIds.length) throw new BadRequestError("Packages may only include active catalog tests");
    const { testIds, ...fields } = input;
    const created = await prisma.labPackage.create({
      data: {
        ...fields,
        tests: { create: testIds.map((testId, displayOrder) => ({ testId, displayOrder })) },
      },
      include: { tests: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { test: true } } },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabPackage", entityId: created.id, newValues: created, req });
    return created;
  },

  async updatePackage(actor: AccessTokenPayload, id: string, input: LabPackageInput, req?: Request) {
    const existing = await prisma.labPackage.findUnique({ where: { id }, include: { tests: true } });
    if (!existing) throw new NotFoundError("Lab package not found");
    const selectedTests = await prisma.labTest.findMany({ where: { id: { in: input.testIds } }, select: { id: true, isActive: true } });
    const existingTestIds = new Set(existing.tests.map((item) => item.testId));
    if (selectedTests.length !== input.testIds.length || selectedTests.some((test) => !test.isActive && !existingTestIds.has(test.id))) {
      throw new BadRequestError("Packages may only add active catalog tests");
    }
    const { testIds, ...fields } = input;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.labPackage.update({ where: { id }, data: { ...fields, isActive: input.isActive ?? existing.isActive } });
      for (const [displayOrder, testId] of testIds.entries()) {
        await tx.labPackageTest.upsert({
          where: { packageId_testId: { packageId: id, testId } },
          create: { packageId: id, testId, displayOrder },
          update: { displayOrder, isActive: true },
        });
      }
      await tx.labPackageTest.updateMany({
        where: { packageId: id, ...(testIds.length ? { testId: { notIn: testIds } } : {}) },
        data: { isActive: false },
      });
      return tx.labPackage.findUniqueOrThrow({
        where: { id },
        include: { tests: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { test: true } } },
      });
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab", entityType: "LabPackage", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async deactivatePackage(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.labPackage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Lab package not found");
    const archived = await prisma.labPackage.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "lab", entityType: "LabPackage", entityId: id, oldValues: existing, newValues: archived, req });
    return archived;
  },

  async list(actor: AccessTokenPayload, params: PageParams & { patientId?: string; status?: string; priority?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.LabOrderWhereInput = {
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.priority ? { priority: params.priority as never } : {}),
      ...(actorDoctorId ? { doctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.labOrder.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        include: {
          patient: { select: { mrNumber: true, firstName: true, lastName: true } },
          test: true,
          results: true,
          doctor: { include: { user: { select: { name: true } } } },
          consultation: { include: { doctor: { include: { user: { select: { name: true } } } } } },
        },
        orderBy: { orderedAt: "desc" },
      }),
      prisma.labOrder.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        criticalResult: item.criticalResult || item.results.some((result) => !result.supersededById && result.interpretation === "CRITICAL"),
        patientName: `${item.patient.firstName} ${item.patient.lastName}`.trim(),
      })),
      total,
    };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const order = await prisma.labOrder.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, age: true, gender: true, dateOfBirth: true } },
        test: { include: { parameters: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { ranges: { where: { isActive: true }, orderBy: { ageMinDays: "asc" } } } } } },
        results: { include: { parameters: { orderBy: { createdAt: "asc" } } } },
        attachments: { orderBy: { uploadedAt: "desc" } },
        verifier: { select: { id: true, name: true, role: true, staffProfile: { select: { qualification: true, specialization: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
        consultation: {
          include: {
            doctor: { include: { user: { select: { name: true } } } },
          },
        },
        invoice: actor.role === "LAB_TECHNICIAN" ? false : {
          select: { id: true, invoiceNumber: true, status: true, grandTotal: true, paidAmount: true, balanceAmount: true },
        },
      },
    });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    const [history, sampleRejections] = await Promise.all([
      prisma.labOrderEvent.findMany({
        where: { labOrderId: id },
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.labSampleRejection.findMany({
        where: { labOrderId: id },
        include: {
          rejector: { select: { id: true, name: true } },
          recollector: { select: { id: true, name: true } },
        },
        orderBy: { rejectedAt: "asc" },
      }),
    ]);
    const resultSavedEvent = [...history].reverse().find((event) => event.eventType === "RESULT_SAVED");
    const technician = resultSavedEvent && resultSavedEvent.actorId
      ? await prisma.user.findUnique({
        where: { id: resultSavedEvent.actorId },
        select: { name: true },
      })
      : null;
    return {
      ...order,
      history,
      sampleRejections,
      technician: technician ? {
        name: technician.name,
        designation: null,
      } : null,
      patientName: `${order.patient.firstName} ${order.patient.lastName}`.trim(),
    };
  },

  async createOrder(actor: AccessTokenPayload, input: LabOrderBillingInput & { testId: string }, req?: Request) {
    const { orders, invoice } = await createBilledLabOrders(actor, input, req);
    return { ...orders[0], invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: invoice.status } };
  },

  async createPackageOrder(actor: AccessTokenPayload, input: LabOrderBillingInput & { packageId: string }, req?: Request) {
    return createBilledLabOrders(actor, input, req);
  },

  async updateSampleStatus(actor: AccessTokenPayload, id: string, status: "SAMPLE_COLLECTED" | "PROCESSING" | "CANCELLED", req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (!canTransitionLabSampleStatus(order.status, status)) {
      throw new ConflictError(`Cannot move order from ${order.status} to ${status}`);
    }
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "lab_orders" WHERE "id" = ${id} FOR UPDATE
      `;
      const current = await tx.labOrder.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (!canTransitionLabSampleStatus(current.status, status)) {
        throw new ConflictError(`Cannot move order from ${current.status} to ${status}`);
      }
      if (status === "SAMPLE_COLLECTED") await ensureLabPaymentBeforeCollection(tx, id);
      if (status === "SAMPLE_COLLECTED") {
        const openRejection = await tx.labSampleRejection.findFirst({
          where: { labOrderId: id, recollectedAt: null },
          select: { id: true },
        });
        if (openRejection) throw new ConflictError("Use the Re-collect Sample action for a rejected specimen");
      }
      const changed = await tx.labOrder.updateMany({
        where: { id, status: current.status },
        data: {
          status,
          ...(status === "SAMPLE_COLLECTED" ? { sampleCollectedAt: new Date() } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictError("Lab order status changed; refresh and try again");
      const updated = await tx.labOrder.findUniqueOrThrow({ where: { id } });
      const eventType: LabOrderEventType = status === "SAMPLE_COLLECTED" ? "SAMPLE_COLLECTED"
        : status === "PROCESSING" ? "PROCESSING" : "CANCELLED";
      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType,
        oldValues: { status: current.status },
        newValues: { status: updated.status },
      });
      await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "lab", entityType: "LabOrder", entityId: id, oldValues: { status: current.status }, newValues: { status: updated.status }, req }, tx);
      return updated;
    });
  },

  async rejectSample(
    actor: AccessTokenPayload,
    id: string,
    input: { reason: "HAEMOLYSED" | "INSUFFICIENT_QUANTITY" | "WRONG_TUBE" | "OTHER"; otherReason?: string },
    req?: Request,
  ) {
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (order.status !== "SAMPLE_COLLECTED") {
      throw new ConflictError("Only a collected sample can be rejected");
    }
    if (input.reason === "OTHER" && !input.otherReason?.trim()) {
      throw new BadRequestError("Describe the other rejection reason");
    }

    return prisma.$transaction(async (tx) => {
      const changed = await tx.labOrder.updateMany({
        where: { id, status: "SAMPLE_COLLECTED" },
        data: { status: "ORDERED", sampleCollectedAt: null },
      });
      if (changed.count !== 1) throw new ConflictError("Lab order status changed; refresh and try again");
      const rejection = await tx.labSampleRejection.create({
        data: {
          labOrderId: id,
          reason: input.reason,
          otherReason: input.reason === "OTHER" ? input.otherReason?.trim() : null,
          rejectedBy: actor.sub,
        },
      });
      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType: "SAMPLE_REJECTED",
        oldValues: { status: order.status },
        newValues: { status: "ORDERED", rejectionId: rejection.id, reason: rejection.reason, otherReason: rejection.otherReason },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "STATUS_CHANGE",
        module: "lab",
        entityType: "LabOrder",
        entityId: id,
        oldValues: { status: order.status },
        newValues: { status: "ORDERED", sampleRejection: { reason: rejection.reason, otherReason: rejection.otherReason } },
        req,
      }, tx);
      return rejection;
    });
  },

  async recollectSample(actor: AccessTokenPayload, id: string, rejectionId: string, req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (order.status !== "ORDERED") throw new ConflictError("A rejected sample can only be recollected while the order is ORDERED");

    return prisma.$transaction(async (tx) => {
      const rejection = await tx.labSampleRejection.findFirst({
        where: { id: rejectionId, labOrderId: id, recollectedAt: null },
      });
      if (!rejection) throw new NotFoundError("Open sample rejection not found");
      await ensureLabPaymentBeforeCollection(tx, id);
      const changed = await tx.labOrder.updateMany({
        where: { id, status: "ORDERED" },
        data: { status: "SAMPLE_COLLECTED", sampleCollectedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictError("Lab order status changed; refresh and try again");
      const recollectedAt = new Date();
      const updatedRejection = await tx.labSampleRejection.updateMany({
        where: { id: rejectionId, labOrderId: id, recollectedAt: null },
        data: { recollectedBy: actor.sub, recollectedAt },
      });
      if (updatedRejection.count !== 1) throw new ConflictError("This rejection was already recollected");
      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType: "SAMPLE_RECOLLECTED",
        oldValues: { status: "ORDERED", rejectionId },
        newValues: { status: "SAMPLE_COLLECTED", rejectionId, sampleCollectedAt: recollectedAt.toISOString() },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "STATUS_CHANGE",
        module: "lab",
        entityType: "LabOrder",
        entityId: id,
        oldValues: { status: "ORDERED" },
        newValues: { status: "SAMPLE_COLLECTED", rejectionId },
        req,
      }, tx);
      return tx.labOrder.findUniqueOrThrow({ where: { id } });
    });
  },

  async recordPrinted(actor: AccessTokenPayload, id: string, req?: Request) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "lab_orders" WHERE "id" = ${id} FOR UPDATE
      `;
      const order = await tx.labOrder.findUnique({
        where: { id },
        include: { results: { where: { supersededById: null }, select: { id: true } } },
      });
      if (!order) throw new NotFoundError("Lab order not found");
      await assertDoctorOwns(actor, order.doctorId);
      if (!["COMPLETED", "VERIFIED"].includes(order.status) || order.results.length === 0) {
        throw new ConflictError("Only a saved result report can be printed");
      }
      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType: "PRINTED",
        newValues: { resultId: order.results[0].id },
      });
      await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab", entityType: "LabOrder", entityId: id, newValues: { printedResultId: order.results[0].id }, req }, tx);
    });
    return { printedAt: new Date().toISOString() };
  },

  /** Each submission creates a result version; earlier saved values remain available in history. */
  async enterResult(
    actor: AccessTokenPayload,
    id: string,
    input: LabResultInput,
    req?: Request,
    amendmentMode = false,
  ) {
    const order = await prisma.labOrder.findUnique({
      where: { id },
      include: {
        patient: true,
        test: { include: { parameters: { where: { isActive: true }, orderBy: { displayOrder: "asc" }, include: { ranges: { where: { isActive: true }, orderBy: { ageMinDays: "asc" } } } } } },
        doctor: { select: { userId: true } },
      },
    });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (amendmentMode && !["ADMIN", "PATHOLOGIST"].includes(actor.role)) {
      throw new ForbiddenError("Only an authorized pathologist may amend a verified report");
    }
    if (amendmentMode ? order.status !== "VERIFIED" : !["PROCESSING", "COMPLETED"].includes(order.status)) {
      throw new ConflictError(amendmentMode
        ? "Only a VERIFIED report can be amended"
        : `Cannot enter results while order status is ${order.status}`);
    }

    const catalogParameters = order.test.parameters;
    let resultParameters: Array<{
      parameterId?: string;
      parameterName: string;
      value: string;
      unit?: string;
      referenceRange?: string;
      computedInterpretation?: LabParameterInterpretation;
      overriddenInterpretation?: LabParameterInterpretation;
      overrideReason?: string;
    }> = [];

    if (catalogParameters.length) {
      if (!input.parameters || input.parameters.length !== catalogParameters.length) {
        throw new BadRequestError("A value is required for every active catalog parameter");
      }
      const submittedById = new Map(input.parameters.map((parameter) => [parameter.parameterId, parameter]));
      if (submittedById.size !== input.parameters.length || catalogParameters.some((parameter) => !submittedById.has(parameter.id))) {
        throw new BadRequestError("Submitted values must match this test's active catalog parameters");
      }
      const criticalThresholdDefaults = await readCriticalThresholdDefaults();
      const ageDays = order.patient.dateOfBirth
        ? Math.floor((Date.now() - order.patient.dateOfBirth.getTime()) / 86_400_000)
        : order.patient.age == null ? null : Math.floor(order.patient.age * 365.2425);
      resultParameters = catalogParameters.map((parameter) => {
        const submitted = submittedById.get(parameter.id)!;
        const value = submitted.value.trim();
        if (!value) throw new BadRequestError(`${parameter.name} is required`);
        let numberValue: number | null = null;
        if (parameter.resultType === "NUMERIC") {
          if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
            throw new BadRequestError(`${parameter.name} must be a valid number`);
          }
          numberValue = Number(value);
        }
        if (submitted.overriddenInterpretation && !submitted.overrideReason?.trim()) {
          throw new BadRequestError(`${parameter.name} interpretation override requires a reason`);
        }
        const selectedRange = resolveLabReferenceRange(
          parameter.ranges.map((range) => ({
            gender: range.gender,
            ageMinDays: range.ageMinDays,
            ageMaxDays: range.ageMaxDays,
            low: range.low?.toString() ?? null,
            high: range.high?.toString() ?? null,
            criticalLow: range.criticalLow?.toString() ?? null,
            criticalHigh: range.criticalHigh?.toString() ?? null,
          })),
          order.patient.gender,
          ageDays,
        );
        const defaults = criticalThresholdDefaults[parameter.id];
        const resolvedRange = applyLabCriticalThresholdDefaults(selectedRange, defaults);
        return {
          parameterId: parameter.id,
          parameterName: parameter.name,
          value,
          unit: parameter.unit ?? undefined,
          referenceRange: formatLabReferenceRange(resolvedRange) ?? undefined,
          computedInterpretation: numberValue == null ? undefined : interpretLabValue(numberValue, resolvedRange) ?? undefined,
          overriddenInterpretation: submitted.overriddenInterpretation,
          overrideReason: submitted.overrideReason?.trim(),
        };
      });
    } else {
      const value = input.resultValue?.trim();
      if (!value) throw new BadRequestError("A result value is required");
      resultParameters = [{
        parameterName: order.test.testName,
        value,
        unit: input.unit,
        referenceRange: input.referenceRange,
        computedInterpretation: input.interpretation === "CRITICAL" ? "CRITICAL_HIGH"
          : input.interpretation === "HIGH" ? "HIGH"
            : input.interpretation === "LOW" ? "LOW"
              : input.interpretation === "NORMAL" ? "NORMAL"
                : undefined,
      }];
    }

    const criticalInterpretations: LabParameterInterpretation[] = ["CRITICAL_LOW", "CRITICAL_HIGH"];
    const anyCritical = resultParameters.some((result) =>
      criticalInterpretations.includes(result.computedInterpretation ?? "NORMAL")
      || criticalInterpretations.includes(result.overriddenInterpretation ?? "NORMAL"),
    ) || (!catalogParameters.length && input.interpretation === "CRITICAL");
    const finalInterpretations = resultParameters
      .map((result) => result.overriddenInterpretation ?? result.computedInterpretation)
      .filter((value): value is LabParameterInterpretation => value != null);
    const summaryInterpretation = anyCritical ? "CRITICAL"
      : finalInterpretations.includes("LOW") ? "LOW"
        : finalInterpretations.includes("HIGH") ? "HIGH"
          : finalInterpretations.includes("NORMAL") ? "NORMAL"
            : input.interpretation;

    const result = await prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<Array<{ status: LabOrderStatus }>>`
        SELECT "status" FROM "lab_orders" WHERE "id" = ${id} FOR UPDATE
      `;
      const lockedStatus = lockedOrders[0]?.status;
      if (amendmentMode ? lockedStatus !== "VERIFIED" : lockedStatus !== "PROCESSING" && lockedStatus !== "COMPLETED") {
        throw new ConflictError(amendmentMode
          ? "Only a VERIFIED report can be amended"
          : `Cannot enter results while order status is ${lockedStatus ?? "missing"}`);
      }
      const previous = await tx.labResult.findFirst({
        where: { labOrderId: id, supersededById: null },
        include: { parameters: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      if (amendmentMode && !previous) throw new NotFoundError("No active result exists to amend");
      const created = await tx.labResult.create({
        data: {
          labOrderId: id,
          resultValue: resultParameters[0].value,
          unit: resultParameters[0].unit,
          referenceRange: resultParameters[0].referenceRange,
          interpretation: summaryInterpretation as never,
          technicianNotes: input.technicianNotes,
          reportRemarks: input.reportRemarks,
          amendmentReason: input.amendmentReason,
          amendedAt: amendmentMode ? new Date() : null,
          createdBy: actor.sub,
          ...(amendmentMode ? { verifiedBy: order.verifiedBy, verifiedAt: order.verifiedAt } : {}),
          parameters: { create: resultParameters },
        },
        include: { parameters: true },
      });
      await tx.labResult.updateMany({
        where: { labOrderId: id, supersededById: null, ...(previous ? { id: previous.id } : {}) },
        data: { supersededById: created.id },
      });
      await tx.labOrder.update({
        where: { id },
        data: {
          status: amendmentMode ? "VERIFIED" : "COMPLETED",
          ...(!amendmentMode ? { completedAt: new Date() } : {}),
          criticalResult: anyCritical,
        },
      });

      if (!amendmentMode && !previous) {
        await consumeLabInventory(tx, {
          orderId: id,
          testId: order.testId,
          resultId: created.id,
          actorId: actor.sub,
          overrideReason: input.inventoryOverrideReason,
        });
      }

      if (anyCritical) {
        if (order.doctor?.userId) {
          await notifyUser(
            {
              userId: order.doctor.userId,
              notificationType: "CRITICAL_LAB_RESULT",
              title: "CRITICAL lab result",
              message: `${order.test.testName} for patient ${order.patient.firstName} ${order.patient.lastName} includes a critical parameter result.`,
              relatedEntityType: "LabOrder",
              relatedEntityId: id,
            },
            tx,
          );
        }
      } else {
        await notifyRoles(
          ["DOCTOR"],
          {
            notificationType: "LAB_RESULT_READY",
            title: "Lab result ready",
            message: `${order.test.testName} result ready for ${order.patient.firstName} ${order.patient.lastName}`,
            relatedEntityType: "LabOrder",
            relatedEntityId: id,
          },
          tx
        );
      }

      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType: amendmentMode ? "AMENDED" : "RESULT_SAVED",
        oldValues: previous ? resultAuditSnapshot(previous) : undefined,
        newValues: resultAuditSnapshot(created),
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabResult", entityId: created.id, newValues: created, req }, tx);
      return created;
    });

    return result;
  },

  /** Amend keeps full history — supersedes old result, never overwrites in place. */
  async amendResult(
    actor: AccessTokenPayload,
    labOrderId: string,
    input: LabResultInput & { reason: string },
    req?: Request
  ) {
    if (!["ADMIN", "PATHOLOGIST"].includes(actor.role)) {
      throw new ForbiddenError("Only an authorized pathologist may amend a verified report");
    }
    const { reason, ...resultInput } = input;
    return labService.enterResult(actor, labOrderId, { ...resultInput, amendmentReason: reason }, req, true);
  },

  async verify(actor: AccessTokenPayload, id: string, req?: Request) {
    if (!["ADMIN", "PATHOLOGIST"].includes(actor.role)) {
      throw new ForbiddenError("Only an authorized pathologist may verify a lab result");
    }
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (order.status !== "COMPLETED") throw new ConflictError("Only COMPLETED orders can be verified");

    const verifiedAt = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "lab_orders" WHERE "id" = ${id} FOR UPDATE
      `;
      const current = await tx.labOrder.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (current.status !== "COMPLETED") throw new ConflictError("Only COMPLETED orders can be verified");
      const result = await tx.labResult.findFirst({
        where: { labOrderId: id, supersededById: null },
        include: { parameters: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      if (!result) throw new ConflictError("A saved result is required before verification");
      const setting = await tx.setting.findUnique({ where: { key: LAB_SAME_USER_VERIFICATION_SETTING } });
      if (!canVerifyLabResult(result.createdBy, actor.sub, setting?.value === true)) {
        throw new ForbiddenError("A result author must be recorded and differ from the verifier");
      }
      const changed = await tx.labOrder.updateMany({
        where: { id, status: "COMPLETED" },
        data: { status: "VERIFIED", verifiedBy: actor.sub, verifiedAt },
      });
      if (changed.count !== 1) throw new ConflictError("This result has already been verified");
      await tx.labResult.update({
        where: { id: result.id },
        data: { verifiedBy: actor.sub, verifiedAt },
      });
      const updated = await tx.labOrder.findUniqueOrThrow({
        where: { id },
        include: { verifier: { select: { id: true, name: true, role: true, staffProfile: { select: { qualification: true, specialization: true } } } } },
      });
      await writeLabOrderEvent(tx, {
        labOrderId: id,
        actorId: actor.sub,
        eventType: "VERIFIED",
        oldValues: { status: current.status },
        newValues: { status: "VERIFIED", resultId: result.id, verifiedAt: verifiedAt.toISOString() },
      });
      await writeAuditLog({ userId: actor.sub, action: "VERIFY", module: "lab", entityType: "LabOrder", entityId: id, oldValues: { status: current.status }, newValues: { status: "VERIFIED", resultId: result.id }, req }, tx);
      return updated;
    });
  },

  async uploadReport(actor: AccessTokenPayload, labOrderId: string, fileUrl: string, fileType: string, originalFilename?: string, req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id: labOrderId } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);

    const attachment = await prisma.labReportAttachment.create({
      data: { labOrderId, fileUrl, fileType, originalFilename, uploadedBy: actor.sub },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabReportAttachment", entityId: attachment.id, newValues: attachment, req });
    return attachment;
  },
};
