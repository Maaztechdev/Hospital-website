import { Prisma, Consultation } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError, ValidationError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";
import { assertAppointmentActionAllowed } from "@modules/appointments/appointmentActions";
import { prescriptionItemsSchema } from "@common/validation/prescription";
import { getAgeInMonthsFromDateOfBirth, getCriticalVitals, isCriticalVitals, type VitalValues } from "@common/validation/vitals";
import type { ConsultationVitalsInput } from "./consultations.validators";

type ConsultationVitalsColumns = Pick<
  Consultation,
  | "bpSystolic"
  | "bpDiastolic"
  | "temperature"
  | "temperatureUnit"
  | "pulse"
  | "weight"
  | "oxygenSaturation"
  | "respiratoryRate"
  | "heightCm"
  | "isCritical"
  | "criticalConfirmed"
  | "vitalsEstimated"
>;

function isCriticalForAge(vitals: VitalValues, age?: number | null, dateOfBirth?: Date | null) {
  return isCriticalVitals(vitals, age, getAgeInMonthsFromDateOfBirth(dateOfBirth));
}

function criticalDetailsForAge(vitals: VitalValues, age?: number | null, dateOfBirth?: Date | null) {
  return getCriticalVitals(vitals, age, getAgeInMonthsFromDateOfBirth(dateOfBirth));
}

function vitalsColumns(vitals: ConsultationVitalsInput | undefined, age?: number | null, dateOfBirth?: Date | null): Partial<ConsultationVitalsColumns> {
  if (!vitals) return {};
  const critical = isCriticalForAge(vitals, age, dateOfBirth);
  if (critical && !vitals.critical_confirmed) {
    const names = criticalDetailsForAge(vitals, age, dateOfBirth).map((item) => `${item.label} ${item.value}${item.unit}`);
    throw new ValidationError(`Confirm critical vital values before saving: ${names.join(", ")}.`);
  }
  return {
    bpSystolic: vitals.bp_systolic ?? null,
    bpDiastolic: vitals.bp_diastolic ?? null,
    temperature: vitals.temperature ?? null,
    temperatureUnit: vitals.temperature === undefined ? null : vitals.temperature_unit ?? "F",
    pulse: vitals.pulse ?? null,
    weight: vitals.weight ?? null,
    oxygenSaturation: vitals.oxygen_saturation ?? null,
    respiratoryRate: vitals.respiratory_rate ?? null,
    heightCm: vitals.height_cm ?? null,
    isCritical: critical,
    criticalConfirmed: critical && Boolean(vitals.critical_confirmed),
    vitalsEstimated: Boolean(vitals.estimated),
  };
}

function consultationVitalValues(consultation: Consultation) {
  return {
    bp_systolic: consultation.bpSystolic,
    bp_diastolic: consultation.bpDiastolic,
    temperature: consultation.temperature,
    temperature_unit: consultation.temperatureUnit === "C" ? "C" as const : "F" as const,
    pulse: consultation.pulse,
    weight: consultation.weight,
    oxygen_saturation: consultation.oxygenSaturation,
    respiratory_rate: consultation.respiratoryRate,
    height_cm: consultation.heightCm,
  };
}

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

      const unpaidInvoice = await tx.invoice.findFirst({
        where: { appointmentId: appointment.id, status: { not: "VOID" }, balanceAmount: { gt: 0 } },
      });
      if (unpaidInvoice && Number(unpaidInvoice.balanceAmount) > 0) {
        throw new BadRequestError(
          `Cannot start consultation: Consultation fee of PKR ${unpaidInvoice.balanceAmount} is unpaid. Payment must be collected or waived at reception.`
        );
      }

      if (appointment.consultation) {
        const consultation = await tx.consultation.update({
          where: { id: appointment.consultation.id },
          data: { startedAt: appointment.consultation.startedAt ?? now },
        });
        if (appointment.status === "CONFIRMED" || appointment.status === "WAITING") {
          await tx.appointment.update({ where: { id: appointment.id }, data: { status: "IN_CONSULTATION" } });
        }
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
      if (appointment.status === "CONFIRMED" || appointment.status === "WAITING") {
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: "IN_CONSULTATION" } });
      }
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
      include: {
        prescriptions: { include: { items: true } },
        addenda: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!consultation) throw new NotFoundError("Consultation not found");
    await assertDoctorOwns(actor, consultation.doctorId);
    return consultation;
  },

  async create(actor: AccessTokenPayload, input: {
    appointmentId: string;
    chiefComplaint?: string;
    vitals?: ConsultationVitalsInput;
    diagnosis?: string;
    diagnosisCode?: string;
    findings?: string;
    clinicalNotes?: string;
    followUpDate?: string;
    followUpInstructions?: string;
    referral?: string;
    expectedUpdatedAt?: string;
  }, req?: Request) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      include: { doctor: true, patient: { select: { age: true, dateOfBirth: true } } },
    });
    if (!appointment) throw new NotFoundError("Appointment not found");
    await assertDoctorOwns(actor, appointment.doctorId);

    const unpaidInvoice = await prisma.invoice.findFirst({
      where: { appointmentId: input.appointmentId, status: { not: "VOID" }, balanceAmount: { gt: 0 } },
    });
    if (unpaidInvoice && Number(unpaidInvoice.balanceAmount) > 0) {
      throw new BadRequestError(
        `Cannot start consultation: Consultation fee of PKR ${unpaidInvoice.balanceAmount} is unpaid. Payment must be collected or waived at reception.`
      );
    }

    const existing = await prisma.consultation.findUnique({ where: { appointmentId: input.appointmentId } });
    if (existing) {
      if (existing.prescriptionStatus === "DRAFT") {
        const updated = await this.update(actor, existing.id, input, req);
        if (appointment.status === "CONFIRMED" || appointment.status === "WAITING") {
          await prisma.appointment.update({
            where: { id: appointment.id },
            data: { status: "IN_CONSULTATION" },
          });
        }
        return updated;
      }
      throw new ConflictError("A consultation already exists for this appointment");
    }

    const consultation = await prisma.consultation.create({
      data: {
        appointmentId: input.appointmentId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        chiefComplaint: input.chiefComplaint,
        ...vitalsColumns(input.vitals, appointment.patient.age, appointment.patient.dateOfBirth),
        diagnosis: input.diagnosis,
        diagnosisCode: input.diagnosisCode,
        findings: input.findings,
        clinicalNotes: input.clinicalNotes,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
        followUpInstructions: input.followUpInstructions,
        referral: input.referral,
      },
    });

    if (appointment.status === "CONFIRMED" || appointment.status === "WAITING") {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "IN_CONSULTATION" },
      });
    }

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "consultations", entityType: "Consultation", entityId: consultation.id, newValues: consultation, req });
    return consultation;
  },

  /** Only the assigned doctor or an admin may edit a DRAFT consultation. */
  async update(actor: AccessTokenPayload, id: string, input: {
    chiefComplaint?: string;
    vitals?: ConsultationVitalsInput;
    diagnosis?: string;
    diagnosisCode?: string;
    findings?: string;
    clinicalNotes?: string;
    followUpDate?: string;
    followUpInstructions?: string;
    referral?: string;
    expectedUpdatedAt?: string;
  }, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true, patient: { select: { age: true, dateOfBirth: true } } } });
    if (!existing) throw new NotFoundError("Consultation not found");

    if (existing.prescriptionStatus === "SIGNED" || existing.prescriptionStatus === "COMPLETED") {
      throw new ConflictError("Signed consultations are read-only and cannot be edited");
    }
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor or an admin may edit this consultation");
    }

    if (!input.expectedUpdatedAt) {
      throw new BadRequestError("expectedUpdatedAt is required");
    }
    const expectedTime = new Date(input.expectedUpdatedAt).getTime();
    const actualTime = new Date(existing.updatedAt).getTime();
    if (expectedTime !== actualTime) {
      throw new ConflictError("This record was changed by another user, reload");
    }

    const data: Prisma.ConsultationUncheckedUpdateManyInput = {
      chiefComplaint: input.chiefComplaint,
      diagnosis: input.diagnosis,
      diagnosisCode: input.diagnosisCode,
      findings: input.findings,
      clinicalNotes: input.clinicalNotes,
      followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
      followUpInstructions: input.followUpInstructions,
      referral: input.referral,
      updatedAt: new Date(),
      ...vitalsColumns(input.vitals, existing.patient.age, existing.patient.dateOfBirth),
    };

    const updateCount = await prisma.consultation.updateMany({
      where: { id, updatedAt: existing.updatedAt },
      data,
    });
    if (updateCount.count === 0) {
      throw new ConflictError("This record was changed by another user, reload");
    }

    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "consultations", entityType: "Consultation", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  /** Signing locks the consultation (prescriptionStatus -> SIGNED) at the service layer. */
  async sign(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true, patient: { select: { age: true, dateOfBirth: true } } } });
    if (!existing) throw new NotFoundError("Consultation not found");
    if (existing.prescriptionStatus !== "DRAFT") throw new ConflictError("Only DRAFT consultations can be signed");
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor may sign this consultation");
    }
    const critical = isCriticalForAge(consultationVitalValues(existing), existing.patient.age, existing.patient.dateOfBirth);
    if (critical && !existing.criticalConfirmed) {
      const names = criticalDetailsForAge(consultationVitalValues(existing), existing.patient.age, existing.patient.dateOfBirth).map((item) => `${item.label} ${item.value}${item.unit}`);
      throw new ValidationError(`Confirm critical vital values before signing: ${names.join(", ")}.`);
    }

    const updateCount = await prisma.consultation.updateMany({
      where: { id, prescriptionStatus: "DRAFT", updatedAt: existing.updatedAt },
      data: { prescriptionStatus: "SIGNED", signedAt: new Date(), isCritical: critical },
    });
    if (updateCount.count === 0) {
      throw new ConflictError("This record was changed by another user, reload");
    }
    const updated = await prisma.consultation.findUniqueOrThrow({ where: { id } });

    await writeAuditLog({ userId: actor.sub, action: "SIGN", module: "consultations", entityType: "Consultation", entityId: id, newValues: { prescriptionStatus: "SIGNED" }, req });
    return updated;
  },

  async complete(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true, patient: { select: { age: true, dateOfBirth: true } } } });
    if (!existing) throw new NotFoundError("Consultation not found");
    if (existing.prescriptionStatus !== "SIGNED") throw new ConflictError("Only signed consultations can be completed");
    if (actor.role !== "ADMIN" && existing.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor may complete this consultation");
    }
    const critical = isCriticalForAge(consultationVitalValues(existing), existing.patient.age, existing.patient.dateOfBirth);
    if (critical && !existing.criticalConfirmed) {
      throw new ValidationError("Confirm critical vital values before completing this consultation.");
    }
    const prescription = await prisma.prescription.findFirst({
      where: { consultationId: id, deletedAt: null },
      include: { items: true },
    });
    if (!prescription || prescription.status !== "SIGNED") {
      throw new ConflictError("A signed prescription with complete medicine details is required before completing this consultation");
    }
    const itemValidation = prescriptionItemsSchema.safeParse(prescription.items);
    if (!itemValidation.success) {
      const issue = itemValidation.error.issues[0];
      const rowIndex = typeof issue.path[0] === "number" ? issue.path[0] + 1 : null;
      throw new ConflictError(rowIndex ? `Medicine ${rowIndex}: ${issue.message}` : issue.message);
    }

    assertAppointmentActionAllowed("IN_CONSULTATION", "COMPLETE");
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.appointment.updateMany({
        where: { id: existing.appointmentId, status: "IN_CONSULTATION" },
        data: { status: "COMPLETED" },
      });
      if (changed.count !== 1) throw new ConflictError("Appointment must be in consultation before completion");
      const consultation = await tx.consultation.update({
        where: { id },
        data: {
          prescriptionStatus: "COMPLETED",
          completedAt: existing.completedAt ?? new Date(),
          isCritical: critical,
        },
      });
      return consultation;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "consultations", entityType: "Consultation", entityId: id, oldValues: { prescriptionStatus: existing.prescriptionStatus }, newValues: { prescriptionStatus: "COMPLETED", appointmentStatus: "COMPLETED" }, req });
    return updated;
  },

  async addAddendum(actor: AccessTokenPayload, id: string, note: string, req?: Request) {
    const consultation = await prisma.consultation.findUnique({ where: { id }, include: { doctor: true } });
    if (!consultation) throw new NotFoundError("Consultation not found");
    if (consultation.prescriptionStatus !== "COMPLETED") throw new ConflictError("Addenda can only be added after consultation completion");
    if (actor.role !== "ADMIN" && consultation.doctor.userId !== actor.sub) {
      throw new ForbiddenError("Only the assigned doctor or an admin may add to this consultation");
    }

    const addendum = await prisma.$transaction(async (tx) => {
      const created = await tx.consultationAddendum.create({
        data: { consultationId: id, authorId: actor.sub, note },
        include: { author: { select: { name: true } } },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "CREATE",
        module: "consultations",
        entityType: "ConsultationAddendum",
        entityId: created.id,
        newValues: { consultationId: id, addendumId: created.id, noteAdded: true },
        req,
      }, tx);
      return created;
    });
    return addendum;
  },
};
