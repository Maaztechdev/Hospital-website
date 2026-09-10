import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";

export const wardsService = {
  async listWards() {
    return prisma.ward.findMany({
      where: { isActive: true },
      include: { rooms: { include: { beds: true } } },
      orderBy: { wardName: "asc" },
    });
  },

  async createWard(actor: AccessTokenPayload, input: { wardName: string; wardType: string }, req?: Request) {
    const ward = await prisma.ward.create({ data: input as never });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "wards", entityType: "Ward", entityId: ward.id, newValues: ward, req });
    return ward;
  },

  async createRoom(actor: AccessTokenPayload, input: { wardId: string; roomNumber: string }, req?: Request) {
    const ward = await prisma.ward.findUnique({ where: { id: input.wardId } });
    if (!ward) throw new NotFoundError("Ward not found");
    const room = await prisma.room.create({ data: input });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "wards", entityType: "Room", entityId: room.id, newValues: room, req });
    return room;
  },

  async createBed(actor: AccessTokenPayload, input: { roomId: string; bedNumber: string; bedLabel?: string; dailyRate?: number }, req?: Request) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room) throw new NotFoundError("Room not found");
    const bed = await prisma.bed.create({ data: input });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "wards", entityType: "Bed", entityId: bed.id, newValues: bed, req });
    return bed;
  },

  /** Live bed availability grid across all wards/rooms. */
  async bedAvailability() {
    const beds = await prisma.bed.findMany({
      where: { isActive: true },
      include: { room: { include: { ward: true } }, admissions: { where: { status: "ACTIVE" }, include: { patient: true } } },
      orderBy: [{ room: { ward: { wardName: "asc" } } }, { bedNumber: "asc" }],
    });
    return beds;
  },

  async listAdmissions(actor: AccessTokenPayload, params: PageParams & { status?: string; patientId?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.AdmissionWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(actorDoctorId ? { attendingDoctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.admission.findMany({ where, skip: params.skip, take: params.limit, include: { patient: true, bed: { include: { room: { include: { ward: true } } } } }, orderBy: { admissionDate: "desc" } }),
      prisma.admission.count({ where }),
    ]);
    return { items, total };
  },

  async getAdmission(actor: AccessTokenPayload, id: string) {
    const admission = await prisma.admission.findUnique({
      where: { id },
      include: { patient: true, bed: { include: { room: { include: { ward: true } } } }, transfers: true, vitalsHistory: true, nursingTasks: true },
    });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    return admission;
  },

  /** Admits a patient: bed must be AVAILABLE. Sets bed to OCCUPIED atomically. */
  async admit(actor: AccessTokenPayload, input: { patientId: string; bedId: string; attendingDoctorId: string; admissionType?: string; admissionReason: string; depositAmount?: number }, req?: Request) {
    await assertDoctorOwns(actor, input.attendingDoctorId);
    const bed = await prisma.bed.findUnique({ where: { id: input.bedId } });
    if (!bed) throw new NotFoundError("Bed not found");
    if (bed.status !== "AVAILABLE") throw new ConflictError(`Bed is not available (current status: ${bed.status})`);

    const admission = await prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: input.bedId }, data: { status: "OCCUPIED" } });
      const created = await tx.admission.create({
        data: {
          patientId: input.patientId,
          bedId: input.bedId,
          attendingDoctorId: input.attendingDoctorId,
          admissionType: (input.admissionType as never) ?? "PLANNED",
          admissionReason: input.admissionReason,
          depositAmount: input.depositAmount ?? 0,
          createdBy: actor.sub,
        },
      });
      await writeAuditLog({ userId: actor.sub, action: "ADMIT", module: "wards", entityType: "Admission", entityId: created.id, newValues: created, req }, tx);
      return created;
    });

    return admission;
  },

  /** Transfers a patient to a new bed: old bed -> AVAILABLE, new bed -> OCCUPIED, logged in bed_transfers. */
  async transferBed(actor: AccessTokenPayload, admissionId: string, toBedId: string, reason: string, req?: Request) {
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    if (admission.status !== "ACTIVE") throw new ConflictError("Only active admissions can be transferred");

    const toBed = await prisma.bed.findUnique({ where: { id: toBedId } });
    if (!toBed) throw new NotFoundError("Destination bed not found");
    if (toBed.status !== "AVAILABLE") throw new ConflictError(`Destination bed is not available (status: ${toBed.status})`);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: "AVAILABLE" } });
      await tx.bed.update({ where: { id: toBedId }, data: { status: "OCCUPIED" } });
      const transfer = await tx.bedTransfer.create({
        data: { admissionId, fromBedId: admission.bedId, toBedId, reason, createdBy: actor.sub },
      });
      const adm = await tx.admission.update({ where: { id: admissionId }, data: { bedId: toBedId } });
      await writeAuditLog({ userId: actor.sub, action: "TRANSFER", module: "wards", entityType: "Admission", entityId: admissionId, newValues: transfer, req }, tx);
      return adm;
    });

    return updated;
  },

  /** Discharges a patient: admission -> DISCHARGED, bed -> CLEANING (must be manually set AVAILABLE after cleaning). */
  async discharge(actor: AccessTokenPayload, admissionId: string, input: { dischargeSummary: string; dischargeNotes?: string }, req?: Request) {
    const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    if (admission.status !== "ACTIVE") throw new ConflictError("Admission is not active");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: "CLEANING" } });
      const adm = await tx.admission.update({
        where: { id: admissionId },
        data: { status: "DISCHARGED", dischargeDate: new Date(), dischargeSummary: input.dischargeSummary, dischargeNotes: input.dischargeNotes },
      });
      await writeAuditLog({ userId: actor.sub, action: "DISCHARGE", module: "wards", entityType: "Admission", entityId: admissionId, newValues: adm, req }, tx);
      return adm;
    });

    return updated;
  },

  async setBedStatus(actor: AccessTokenPayload, bedId: string, status: string, req?: Request) {
    const bed = await prisma.bed.findUnique({ where: { id: bedId } });
    if (!bed) throw new NotFoundError("Bed not found");
    if (bed.status === "OCCUPIED" && status === "AVAILABLE") {
      throw new ConflictError("Cannot mark an occupied bed as available — discharge the patient first");
    }
    const updated = await prisma.bed.update({ where: { id: bedId }, data: { status: status as never } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "wards", entityType: "Bed", entityId: bedId, oldValues: { status: bed.status }, newValues: { status }, req });
    return updated;
  },
};
