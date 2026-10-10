import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";
import { savePrivateUpload } from "@common/utils/privateFiles";
import { describeFrequency, getMedicationAllergyMatches, normalizeMedicineName, prescriptionItemsSchema, type DoseUnit, type DurationUnit, type FrequencyCode, type PrescriptionRoute } from "@common/validation/prescription";
import type { z } from "zod";
import type { prescriptionTemplateSchema } from "./prescriptions.validators";

interface PrescriptionItemInput {
  medicineId?: string;
  isCatalogItem: boolean;
  medicineName: string;
  doseAmount: number;
  doseUnit: DoseUnit;
  route: PrescriptionRoute;
  frequencyCode: FrequencyCode;
  durationValue: number;
  durationUnit: DurationUnit;
  instructions?: string;
}

interface PrescriptionPadDataInput {
  visitNumber?: string;
  visitDate?: string;
  visitTime?: string;
  relationship?: string;
  patientAddress?: string;
  patientContact?: string;
  patientAge?: number;
  patientGender?: "MALE" | "FEMALE" | "OTHER";
  patientWeight?: string;
  vitals?: Record<string, unknown>;
  allergies?: string;
  presentingComplaints?: string;
  history?: string;
  findings?: string;
  investigations?: string;
  rxText?: string;
  refillNumber?: number;
}

interface PrescriptionCreateInput {
  consultationId: string;
  items: PrescriptionItemInput[];
  padData?: PrescriptionPadDataInput;
  allergyOverrides?: string[];
}

async function getPadConfig(doctorId: string) {
  return prisma.prescriptionPadConfig.findUnique({ where: { doctorId } });
}

function padDataFields(padData?: PrescriptionPadDataInput): Partial<Prisma.PrescriptionUncheckedCreateInput> {
  if (!padData) return {};
  return {
    visitNumber: padData.visitNumber,
    visitDate: padData.visitDate ? new Date(padData.visitDate) : undefined,
    visitTime: padData.visitTime,
    relationship: padData.relationship,
    patientAddress: padData.patientAddress,
    patientContact: padData.patientContact,
    patientAge: padData.patientAge,
    patientGender: padData.patientGender,
    patientWeight: padData.patientWeight,
    vitalsJson: padData.vitals as Prisma.InputJsonValue | undefined,
    allergies: padData.allergies,
    presentingComplaints: padData.presentingComplaints,
    history: padData.history,
    findings: padData.findings,
    investigations: padData.investigations,
    rxText: padData.rxText,
    refillNumber: padData.refillNumber,
  };
}

export const prescriptionsService = {
  async listTemplates(actor: AccessTokenPayload) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ForbiddenError("Prescription templates are available to doctors only");
    return prisma.prescriptionTemplate.findMany({ where: { doctorId }, orderBy: { updatedAt: "desc" } });
  },

  async createTemplate(actor: AccessTokenPayload, input: z.infer<typeof prescriptionTemplateSchema>, req?: Request) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ForbiddenError("Prescription templates are available to doctors only");
    const duplicate = await prisma.prescriptionTemplate.findUnique({ where: { doctorId_name: { doctorId, name: input.name } } });
    if (duplicate) throw new ConflictError("A template with this name already exists");
    const created = await prisma.prescriptionTemplate.create({
      data: { doctorId, name: input.name, items: input.items },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "prescriptions", entityType: "PrescriptionTemplate", entityId: created.id, newValues: { name: created.name }, req });
    return created;
  },

  async updateTemplate(actor: AccessTokenPayload, id: string, input: z.infer<typeof prescriptionTemplateSchema>, req?: Request) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ForbiddenError("Prescription templates are available to doctors only");
    const existing = await prisma.prescriptionTemplate.findFirst({ where: { id, doctorId } });
    if (!existing) throw new NotFoundError("Prescription template not found");
    const duplicate = await prisma.prescriptionTemplate.findFirst({ where: { doctorId, name: input.name, NOT: { id } } });
    if (duplicate) throw new ConflictError("A template with this name already exists");
    const updated = await prisma.prescriptionTemplate.update({ where: { id }, data: { name: input.name, items: input.items } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "prescriptions", entityType: "PrescriptionTemplate", entityId: id, oldValues: { name: existing.name }, newValues: { name: updated.name }, req });
    return updated;
  },

  async deleteTemplate(actor: AccessTokenPayload, id: string, req?: Request) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ForbiddenError("Prescription templates are available to doctors only");
    const existing = await prisma.prescriptionTemplate.findFirst({ where: { id, doctorId } });
    if (!existing) throw new NotFoundError("Prescription template not found");
    await prisma.prescriptionTemplate.delete({ where: { id } });
    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "prescriptions", entityType: "PrescriptionTemplate", entityId: id, oldValues: { name: existing.name }, req });
    return null;
  },

  async createShare(actor: AccessTokenPayload, id: string, req?: Request) {
    const prescription = await this.getById(actor, id);
    if (prescription.status !== "SIGNED" && prescription.status !== "COMPLETED") {
      throw new ConflictError("Only signed prescriptions can be shared");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const share = await prisma.prescriptionShare.create({
      data: { prescriptionId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt, createdBy: actor.sub },
      select: { id: true, expiresAt: true },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "prescriptions", entityType: "PrescriptionShare", entityId: share.id, newValues: { prescriptionId: id, expiresAt }, req });
    return { ...share, token };
  },

  async attachSharePdf(actor: AccessTokenPayload, prescriptionId: string, shareId: string, file: Express.Multer.File, req?: Request) {
    await this.getById(actor, prescriptionId);
    const share = await prisma.prescriptionShare.findFirst({ where: { id: shareId, prescriptionId, createdBy: actor.sub, expiresAt: { gt: new Date() } } });
    if (!share) throw new NotFoundError("Prescription share link not found or expired");
    const fileUrl = await savePrivateUpload(file, "document", "shared-prescriptions");
    const filePath = fileUrl.split("/files/")[1];
    if (!filePath) throw new Error("Unable to determine the stored prescription PDF path");
    const updated = await prisma.prescriptionShare.update({ where: { id: share.id }, data: { filePath }, select: { id: true, expiresAt: true } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "prescriptions", entityType: "PrescriptionShare", entityId: share.id, newValues: { pdfAttached: true }, req });
    return updated;
  },

  async getPublicShare(token: string, requirePdf = false) {
    if (token.length !== 43) throw new NotFoundError("Shared prescription not found");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const share = await prisma.prescriptionShare.findUnique({
      where: { tokenHash },
      include: { prescription: { select: { status: true, signedAt: true, doctor: { select: { user: { select: { name: true } } } } } } },
    });
    if (!share || share.expiresAt <= new Date() || share.prescription.status === "VOID") {
      throw new NotFoundError("Shared prescription not found or expired");
    }
    if (requirePdf && !share.filePath) throw new NotFoundError("The shared prescription PDF is not available");
    return {
      filePath: share.filePath,
      valid: ["SIGNED", "COMPLETED", "DISPENSED"].includes(share.prescription.status),
      signedAt: share.prescription.signedAt,
      doctorName: share.prescription.doctor.user.name,
      expiresAt: share.expiresAt,
    };
  },

  async list(actor: AccessTokenPayload, params: PageParams & { patientId?: string; status?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.PrescriptionWhereInput = {
      deletedAt: null,
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(actorDoctorId ? { doctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        include: {
          items: { include: { medicine: { select: { genericName: true } } } },
          patient: { select: { firstName: true, lastName: true, mrNumber: true } },
          doctor: { include: { user: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.prescription.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const rx = await prisma.prescription.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { include: { medicine: { select: { genericName: true } } } },
        patient: { select: { firstName: true, lastName: true, mrNumber: true } },
        doctor: { include: { user: { select: { name: true } } } },
      },
    });
    if (!rx) throw new NotFoundError("Prescription not found");
    await assertDoctorOwns(actor, rx.doctorId);
    return rx;
  },

  async getConsultationPrintData(actor: AccessTokenPayload, consultationId: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: consultationId },
      include: {
        patient: true,
        appointment: true,
        doctor: {
          include: {
            user: { select: { id: true, name: true, staffProfile: { select: { qualification: true, signatureUrl: true, stampUrl: true } } } },
            prescriptionPadConfig: true,
          },
        },
        prescriptions: {
          where: { deletedAt: null, status: { in: ["SIGNED", "COMPLETED", "DISPENSED"] } },
          take: 1,
          include: { items: { include: { medicine: { select: { genericName: true } } } } },
        },
      },
    });
    if (!consultation) throw new NotFoundError("Consultation not found");
    await assertDoctorOwns(actor, consultation.doctorId);
    if (!consultation.prescriptions[0]) throw new NotFoundError("Signed prescription not found for this consultation");
    return { ...consultation, prescription: consultation.prescriptions[0] };
  },

  async create(actor: AccessTokenPayload, input: PrescriptionCreateInput, req?: Request) {
    const consultation = await prisma.consultation.findUnique({
      where: { id: input.consultationId },
      include: { patient: { select: { allergies: true } } },
    });
    if (!consultation) throw new NotFoundError("Consultation not found");
    await assertDoctorOwns(actor, consultation.doctorId);

    const existing = await prisma.prescription.findFirst({ where: { consultationId: input.consultationId, deletedAt: null } });
    if (existing) throw new ConflictError("A prescription already exists for this consultation");

    const allergyOverrides = new Set((input.allergyOverrides ?? []).map(normalizeMedicineName));
    const preparedItems = await Promise.all(input.items.map(async (item) => {
      const medicine = item.isCatalogItem && item.medicineId
        ? await prisma.medicine.findUnique({
            where: { id: item.medicineId },
            select: { name: true, genericName: true, strength: true, isActive: true, category: { select: { name: true } } },
          })
        : null;
      if (item.isCatalogItem && !medicine) throw new NotFoundError("Selected medicine not found");
      if (medicine && !medicine.isActive) throw new ConflictError("Selected medicine is no longer active in the pharmacy catalog");
      const medicineName = item.isCatalogItem && medicine
        ? `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`
        : item.medicineName;
      const matches = getMedicationAllergyMatches(
        consultation.patient.allergies,
        medicineName,
        item.medicineName,
        medicine?.name,
        medicine?.genericName,
        medicine?.category?.name,
      );
      if (matches.length && !allergyOverrides.has(normalizeMedicineName(item.medicineName))) {
        throw new ConflictError(`Patient is allergic to ${matches.join(", ")}. Confirm override before prescribing.`);
      }
      const durationDays = item.durationUnit === "weeks"
        ? item.durationValue * 7
        : item.durationUnit === "months"
          ? item.durationValue * 30
          : item.durationValue;
      const frequencyDescription = describeFrequency(item.frequencyCode);
      return {
        medicineId: item.isCatalogItem ? item.medicineId : undefined,
        isCatalogItem: item.isCatalogItem,
        requiresPharmacistReview: !item.isCatalogItem,
        medicineName,
        dosage: `${item.doseAmount} ${item.doseUnit}`,
        doseAmount: item.doseAmount,
        doseUnit: item.doseUnit,
        route: item.route,
        frequency: `${item.frequencyCode} - ${frequencyDescription}`,
        frequencyCode: item.frequencyCode,
        durationDays,
        durationValue: item.durationValue,
        durationUnit: item.durationUnit,
        instructions: item.instructions,
        allergyMatches: matches,
      };
    }));

    const prescription = await prisma.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          consultationId: input.consultationId,
          patientId: consultation.patientId,
          doctorId: consultation.doctorId,
          status: "DRAFT",
          ...padDataFields(input.padData),
          items: {
            create: preparedItems.map(({ allergyMatches: _allergyMatches, ...item }) => item),
          },
        },
        include: { items: true },
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "prescriptions", entityType: "Prescription", entityId: created.id, newValues: created, req }, tx);
      for (const item of preparedItems.filter((prepared) => prepared.allergyMatches.length > 0)) {
        await writeAuditLog({
          userId: actor.sub,
          action: "UPDATE",
          module: "prescriptions",
          entityType: "PrescriptionAllergyOverride",
          entityId: created.id,
          newValues: { medicineName: item.medicineName, allergies: item.allergyMatches, overrideConfirmed: true },
          req,
        }, tx);
      }
      return created;
    });

    return prescription;
  },

  /** Sign — after which the record becomes read-only. No hard delete ever. */
  async sign(actor: AccessTokenPayload, id: string, req?: Request) {
    const rx = await prisma.prescription.findFirst({ where: { id, deletedAt: null }, include: { items: true } });
    if (!rx) throw new NotFoundError("Prescription not found");
    await assertDoctorOwns(actor, rx.doctorId);
    const idempotencyKey = req?.get("Idempotency-Key");
    if (idempotencyKey && rx.signIdempotencyKey === idempotencyKey && rx.status === "SIGNED") return rx;
    if (rx.status !== "DRAFT") throw new ConflictError("Only DRAFT prescriptions can be signed");
    const itemValidation = prescriptionItemsSchema.safeParse(rx.items);
    if (!itemValidation.success) {
      const issue = itemValidation.error.issues[0];
      const rowIndex = typeof issue.path[0] === "number" ? issue.path[0] + 1 : null;
      throw new ConflictError(rowIndex ? `Medicine ${rowIndex}: ${issue.message}` : issue.message);
    }

    const configuration = await getPadConfig(rx.doctorId);

    const configurationSnapshot = configuration ? JSON.parse(JSON.stringify(configuration)) as Prisma.InputJsonValue : undefined;
    const updated = await prisma.prescription.update({ where: { id }, data: { status: "SIGNED", signedAt: new Date(), signIdempotencyKey: idempotencyKey, configurationSnapshot }, include: { items: true } });
    await writeAuditLog({ userId: actor.sub, action: "SIGN", module: "prescriptions", entityType: "Prescription", entityId: id, newValues: { status: "SIGNED" }, req });
    return updated;
  },

  async voidPrescription(actor: AccessTokenPayload, id: string, reason: string, req?: Request) {
    const rx = await prisma.prescription.findFirst({ where: { id, deletedAt: null } });
    if (!rx) throw new NotFoundError("Prescription not found");
    await assertDoctorOwns(actor, rx.doctorId);
    if (rx.status === "VOID") throw new ConflictError("Prescription already void");

    const updated = await prisma.prescription.update({ where: { id }, data: { status: "VOID", voidReason: reason } });
    await writeAuditLog({ userId: actor.sub, action: "VOID", module: "prescriptions", entityType: "Prescription", entityId: id, oldValues: { status: rx.status }, newValues: { status: "VOID", reason }, req });
    return updated;
  },
};
