import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateMrNumber } from "@common/utils/sequenceGenerators";
import { PageParams } from "@common/utils/pagination";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { assertPatientAccess } from "@common/utils/recordAuthorization";

interface CreatePatientInput {
  firstName: string;
  lastName: string;
  age: number;
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

export function canExposePatientBalance(role: string): boolean {
  return role !== "LAB_TECHNICIAN";
}

export const patientsService = {
  async list(actor: AccessTokenPayload, params: PageParams & { search?: string }) {
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      NOT: [{ firstName: { contains: "Lifecycle", mode: "insensitive" } }, { lastName: { contains: "Lifecycle", mode: "insensitive" } }],
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
      prisma.patient.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.patient.count({ where }),
    ]);

    const includeBalances = canExposePatientBalance(actor.role);
    const invoices = !includeBalances || items.length === 0
      ? []
      : await prisma.invoice.findMany({
        where: { patientId: { in: items.map((patient) => patient.id) }, status: { not: "VOID" } },
        select: { patientId: true, balanceAmount: true },
      });
    const balancesByPatient = new Map<string, number>();
    for (const invoice of invoices) {
      if (!invoice.patientId) continue;
      balancesByPatient.set(invoice.patientId, (balancesByPatient.get(invoice.patientId) ?? 0) + Number(invoice.balanceAmount));
    }

    const lastVisitRows = items.length > 0
      ? await prisma.$queryRaw<Array<{ patientId: string; lastVisit: string | null }>>`
          SELECT p.id AS "patientId",
            GREATEST(
              MAX(a.appointment_date),
              MAX(((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')::date)
            )::text AS "lastVisit"
          FROM patients p
          LEFT JOIN appointments a ON a.patient_id = p.id AND a.status = 'DONE'
          LEFT JOIN consultations c ON c.patient_id = p.id AND c.prescription_status IN ('SIGNED', 'COMPLETED')
          WHERE p.id IN (${Prisma.join(items.map((patient) => patient.id))})
          GROUP BY p.id
        `
      : [];
    const lastVisitByPatient = new Map(lastVisitRows.map((row) => [row.patientId, row.lastVisit]));

    return {
      items: items.map((patient) => {
        const lastVisit = lastVisitByPatient.get(patient.id) ?? null;
        return {
          ...patient,
          age: Math.max(0, patient.age ?? 0),
          lastVisit,
          ...(includeBalances ? { balance: balancesByPatient.get(patient.id) ?? 0 } : {}),
        };
      }),
      total,
    };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const patient = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");
    return patient;
  },

  async create(actorId: string, input: CreatePatientInput, req?: import("express").Request) {
    const phone = input.phone.replace(/\D/g, "");
    const formattedPhone = phone.length === 11 && phone.startsWith("03")
      ? `${phone.slice(0, 4)}-${phone.slice(4)}`
      : phone;
    const address = input.address?.trim();
    // Duplicate detection by phone + CNIC
    if (!input.force) {
      const duplicate = await prisma.patient.findFirst({
        where: {
          deletedAt: null,
          phone: { in: [...new Set([phone, formattedPhone])] },
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

    const patient = await prisma.$transaction(async (tx) => {
      const mrNumber = await generateMrNumber(tx);
      return tx.patient.create({
        data: {
          mrNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          age: input.age,
          gender: input.gender as never,
          phone,
          email: input.email,
          address: address && address.toLowerCase() !== "none" ? address : undefined,
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
    if (typeof input.phone === "string") data.phone = input.phone.replace(/\D/g, "");
    if (typeof input.address === "string") {
      const address = input.address.trim();
      data.address = address && address.toLowerCase() !== "none" ? address : null;
    }
    if (typeof input.age === "number") {
      data.age = input.age;
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
