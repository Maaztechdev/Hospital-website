import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateMrNumber } from "@common/utils/sequenceGenerators";
import { PageParams } from "@common/utils/pagination";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { assertPatientAccess } from "@common/utils/recordAuthorization";

function calculateAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

interface CreatePatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email?: string;
  address?: string;
  cnic?: string;
  bloodGroup?: string;
  allergies?: string[];
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  force?: boolean;
}

export const patientsService = {
  async list(actor: AccessTokenPayload, params: PageParams & { search?: string }) {
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      ...(params.search
        ? {
            OR: [
              { firstName: { contains: params.search, mode: "insensitive" } },
              { lastName: { contains: params.search, mode: "insensitive" } },
              { phone: { contains: params.search } },
              { mrNumber: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    if (actor.role === "DOCTOR") {
      const access = await prisma.patient.findMany({
        where: { ...where, OR: [{ appointments: { some: { doctor: { userId: actor.sub } } } }, { consultations: { some: { doctor: { userId: actor.sub } } } }, { labOrders: { some: { doctor: { userId: actor.sub } } } }, { admissions: { some: { attendingDoctor: { userId: actor.sub } } } }, { surgeries: { some: { surgeon: { userId: actor.sub } } } }] },
        select: { id: true },
      });
      where.id = { in: access.map((patient) => patient.id) };
    }

    const [items, total] = await Promise.all([
      prisma.patient.findMany({ where, skip: params.skip, take: params.limit, orderBy: { createdAt: "desc" } }),
      prisma.patient.count({ where }),
    ]);

    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const patient = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");
    return patient;
  },

  async create(actorId: string, input: CreatePatientInput, req?: import("express").Request) {
    // Duplicate detection by phone + CNIC
    if (!input.force) {
      const duplicate = await prisma.patient.findFirst({
        where: {
          deletedAt: null,
          phone: input.phone,
          ...(input.cnic ? { cnic: input.cnic } : {}),
        },
      });
      if (duplicate) {
        throw new ConflictError(
          "A patient with this phone/CNIC already exists. Pass force=true to create anyway.",
          { existingPatientId: duplicate.id, existingMrNumber: duplicate.mrNumber }
        );
      }
    }

    const dob = new Date(input.dateOfBirth);
    const age = calculateAge(dob);

    const patient = await prisma.$transaction(async (tx) => {
      const mrNumber = await generateMrNumber(tx);
      return tx.patient.create({
        data: {
          mrNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: dob,
          age,
          gender: input.gender as never,
          phone: input.phone,
          email: input.email,
          address: input.address,
          cnic: input.cnic,
          bloodGroup: input.bloodGroup as never,
          allergies: input.allergies ?? [],
          emergencyContactName: input.emergencyContactName,
          emergencyContactPhone: input.emergencyContactPhone,
          notes: input.notes,
          createdBy: actorId,
        },
      });
    });

    await writeAuditLog({ userId: actorId, action: "CREATE", module: "patients", entityType: "Patient", entityId: patient.id, newValues: patient, req });
    return patient;
  },

  async update(actorId: string, id: string, input: Partial<CreatePatientInput>, req?: import("express").Request) {
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("Patient not found");

    const data: Prisma.PatientUpdateInput = { ...input } as never;
    if (input.dateOfBirth) {
      const dob = new Date(input.dateOfBirth);
      data.dateOfBirth = dob;
      data.age = calculateAge(dob);
    }

    const updated = await prisma.patient.update({ where: { id }, data });

    await writeAuditLog({
      userId: actorId,
      action: "UPDATE",
      module: "patients",
      entityType: "Patient",
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req,
    });
    return updated;
  },

  async softDelete(actorId: string, id: string, req?: import("express").Request) {
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("Patient not found");

    const updated = await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAuditLog({ userId: actorId, action: "DELETE", module: "patients", entityType: "Patient", entityId: id, oldValues: existing, req });
    return updated;
  },

  /** Admin-only merge of duplicate patient records — reassigns all related records, audit-logged. */
  async merge(actorId: string, primaryPatientId: string, duplicatePatientId: string, req?: import("express").Request) {
    if (primaryPatientId === duplicatePatientId) {
      throw new BadRequestError("Cannot merge a patient into itself");
    }

    const [primary, duplicate] = await Promise.all([
      prisma.patient.findFirst({ where: { id: primaryPatientId, deletedAt: null } }),
      prisma.patient.findFirst({ where: { id: duplicatePatientId, deletedAt: null } }),
    ]);
    if (!primary) throw new NotFoundError("Primary patient not found");
    if (!duplicate) throw new NotFoundError("Duplicate patient not found");

    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.consultation.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.prescription.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.labOrder.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.invoice.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.admission.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.surgery.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });

      await tx.patient.update({
        where: { id: duplicatePatientId },
        data: { deletedAt: new Date(), mergedIntoPatientId: primaryPatientId },
      });

      await writeAuditLog(
        {
          userId: actorId,
          action: "UPDATE",
          module: "patients",
          entityType: "Patient",
          entityId: primaryPatientId,
          oldValues: { duplicatePatientId },
          newValues: { mergedFrom: duplicatePatientId },
          req,
        },
        tx
      );
    });

    return { primaryPatientId, mergedPatientId: duplicatePatientId };
  },
};
