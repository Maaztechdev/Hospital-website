import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";

interface PrescriptionItemInput {
  medicineId?: string;
  medicineName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  instructions?: string;
}

export const prescriptionsService = {
  async list(actor: AccessTokenPayload, params: PageParams & { patientId?: string; status?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.PrescriptionWhereInput = {
      deletedAt: null,
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(actorDoctorId ? { doctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.prescription.findMany({ where, skip: params.skip, take: params.limit, include: { items: true }, orderBy: { createdAt: "desc" } }),
      prisma.prescription.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const rx = await prisma.prescription.findFirst({ where: { id, deletedAt: null }, include: { items: true } });
    if (!rx) throw new NotFoundError("Prescription not found");
    await assertDoctorOwns(actor, rx.doctorId);
    return rx;
  },

  async create(actor: AccessTokenPayload, input: { consultationId: string; items: PrescriptionItemInput[] }, req?: Request) {
    const consultation = await prisma.consultation.findUnique({ where: { id: input.consultationId } });
    if (!consultation) throw new NotFoundError("Consultation not found");
    await assertDoctorOwns(actor, consultation.doctorId);

    const prescription = await prisma.prescription.create({
      data: {
        consultationId: input.consultationId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        status: "DRAFT",
        items: { create: input.items },
      },
      include: { items: true },
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "prescriptions", entityType: "Prescription", entityId: prescription.id, newValues: prescription, req });
    return prescription;
  },

  /** Sign — after which the record becomes read-only. No hard delete ever. */
  async sign(actor: AccessTokenPayload, id: string, req?: Request) {
    const rx = await prisma.prescription.findFirst({ where: { id, deletedAt: null } });
    if (!rx) throw new NotFoundError("Prescription not found");
    await assertDoctorOwns(actor, rx.doctorId);
    const idempotencyKey = req?.get("Idempotency-Key");
    if (idempotencyKey && rx.signIdempotencyKey === idempotencyKey && rx.status === "SIGNED") return rx;
    if (rx.status !== "DRAFT") throw new ConflictError("Only DRAFT prescriptions can be signed");

    const updated = await prisma.prescription.update({ where: { id }, data: { status: "SIGNED", signedAt: new Date(), signIdempotencyKey: idempotencyKey } });
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
