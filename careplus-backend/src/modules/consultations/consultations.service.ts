import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ForbiddenError, NotFoundError, ConflictError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";

export const consultationsService = {
  async start(actor: AccessTokenPayload, input: { patientId: string }, req?: Request) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ForbiddenError("A doctor profile is required to start a consultation");
    const patient = await prisma.patient.findFirst({ where: { id: input.patientId, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: {
          patientId: patient.id,
          doctorId,
          status: { not: "CANCELLED" },
        },
        include: { consultation: true },
        orderBy: [{ appointmentDate: "desc" }, { createdAt: "desc" }],
      });

      if (!appointment) {
        throw new NotFoundError("No scheduled appointment found for this patient with the doctor");
      }

      if (appointment.consultation) {
        const consultation = await tx.consultation.update({
          where: { id: appointment.consultation.id },
          data: { startedAt: appointment.consultation.startedAt ?? now },
        });
        return { consultation, created: false };
      }

      const consultation = await tx.consultation.upsert({
        where: { appointmentId: appointment.id },
        create: {
          appointmentId: appointment.id,
          patientId: patient.id,
          doctorId,
          startedAt: now,
        },
        update: {
          startedAt: now,
        },
      });
      return { consultation, created: true };
    });

    if (result.created) {
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "consultations", entityType: "Consultation", entityId: result.consultation.id, newValues: result.consultation, req });
    }
    return result.consultation;
  },

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

  async create(actor: AccessTokenPayload, input: { appointmentId: string; chiefComplaint?: string; vitals?: unknown; diagnosis?: string; findings?: string; clinicalNotes?: string; followUpDate?: string; referral?: string }, req?: Request) {
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
        findings: input.findings,
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

  async complete(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true } });
    if (!existing) throw new NotFoundError("Consultation not found");
    if (existing.prescriptionStatus !== "SIGNED") throw new ConflictError("Only signed consultations can be completed");
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor may complete this consultation");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const consultation = await tx.consultation.update({
        where: { id },
        data: {
          prescriptionStatus: "COMPLETED",
          completedAt: existing.completedAt ?? new Date(),
        },
      });
      await tx.appointment.update({ where: { id: existing.appointmentId }, data: { status: "DONE" } });
      return consultation;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "consultations", entityType: "Consultation", entityId: id, oldValues: { prescriptionStatus: existing.prescriptionStatus }, newValues: { prescriptionStatus: "COMPLETED", appointmentStatus: "DONE" }, req });
    return updated;
  },
};
