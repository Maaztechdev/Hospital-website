import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ForbiddenError, NotFoundError, ConflictError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";

export const consultationsService = {
  async list(actor: AccessTokenPayload, params: PageParams & { appointmentId?: string; patientId?: string; doctorId?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.ConsultationWhereInput = {
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.doctorId ? { doctorId: params.doctorId } : {}),
      ...(actorDoctorId ? { doctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.consultation.findMany({ where, skip: params.skip, take: params.limit, orderBy: { createdAt: "desc" } }),
      prisma.consultation.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const consultation = await prisma.consultation.findUnique({
      where: { id },
      include: { prescriptions: { include: { items: true } } },
    });
    if (!consultation) throw new NotFoundError("Consultation not found");
    await assertDoctorOwns(actor, consultation.doctorId);
    return consultation;
  },

  async create(actor: AccessTokenPayload, input: { appointmentId: string; chiefComplaint?: string; vitals?: unknown; diagnosis?: string; clinicalNotes?: string; followUpDate?: string; referral?: string }, req?: Request) {
    const appointment = await prisma.appointment.findUnique({ where: { id: input.appointmentId }, include: { doctor: true } });
    if (!appointment) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appointment.doctorId);

    const existing = await prisma.consultation.findUnique({ where: { appointmentId: input.appointmentId } });
    if (existing) throw new ConflictError("A consultation already exists for this appointment");

    const consultation = await prisma.consultation.create({
      data: {
        appointmentId: input.appointmentId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        chiefComplaint: input.chiefComplaint,
        vitalsJson: input.vitals as Prisma.InputJsonValue,
        diagnosis: input.diagnosis,
        clinicalNotes: input.clinicalNotes,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
        referral: input.referral,
      },
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "consultations", entityType: "Consultation", entityId: consultation.id, newValues: consultation, req });
    return consultation;
  },

  /** Only the assigned doctor or an admin may edit a DRAFT consultation. */
  async update(actor: AccessTokenPayload, id: string, input: Record<string, unknown>, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true } });
    if (!existing) throw new NotFoundError("Consultation not found");

    if (existing.prescriptionStatus === "SIGNED" || existing.prescriptionStatus === "COMPLETED") {
      throw new ConflictError("Signed consultations are read-only and cannot be edited");
    }
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor or an admin may edit this consultation");
    }

    const data: Prisma.ConsultationUpdateInput = { ...input } as never;
    if (input.followUpDate) data.followUpDate = new Date(input.followUpDate as string);
    if (input.vitals) {
      data.vitalsJson = input.vitals as Prisma.InputJsonValue;
      delete (data as Record<string, unknown>).vitals;
    }

    const updated = await prisma.consultation.update({ where: { id }, data });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "consultations", entityType: "Consultation", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  /** Signing locks the consultation (prescriptionStatus -> SIGNED) at the service layer. */
  async sign(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true } });
    if (!existing) throw new NotFoundError("Consultation not found");
    if (existing.prescriptionStatus !== "DRAFT") throw new ConflictError("Only DRAFT consultations can be signed");
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor may sign this consultation");
    }

    const updated = await prisma.consultation.update({
      where: { id },
      data: { prescriptionStatus: "SIGNED", signedAt: new Date() },
    });

    await writeAuditLog({ userId: actor.sub, action: "SIGN", module: "consultations", entityType: "Consultation", entityId: id, newValues: { prescriptionStatus: "SIGNED" }, req });
    return updated;
  },
};
