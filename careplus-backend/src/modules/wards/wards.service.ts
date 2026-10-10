import { BedStatus, Prisma, WardType } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns, assertDoctorCanAdmitPatient } from "@common/utils/recordAuthorization";
import { assertBedStatusTransitionAllowed } from "./bedStatusTransitions";

export const wardsService = {
  async listWards(includeInactive = false) {
    return prisma.ward.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { rooms: { include: { beds: true } } },
      orderBy: { wardName: "asc" },
    });
  },

  async updateWard(actor: AccessTokenPayload, id: string, input: { wardName: string; wardType: string; dailyRate: number; capacity: number; amenities: string[]; isActive: boolean }, req?: Request) {
    const existing = await prisma.ward.findUnique({ where: { id }, include: { rooms: { include: { beds: true } } } });
    if (!existing) throw new NotFoundError("Ward not found");
    const duplicate = await prisma.ward.findFirst({ where: { wardName: input.wardName, NOT: { id } } });
    if (duplicate) throw new ConflictError("Ward type name must be unique");
    const bedCount = existing.rooms.reduce((total, room) => total + room.beds.length, 0);
    if (input.capacity < bedCount) throw new ConflictError(`Capacity cannot be lower than the ${bedCount} existing beds`);
    const updated = await prisma.$transaction(async (tx) => {
      const ward = await tx.ward.update({ where: { id }, data: { ...input, wardType: input.wardType as WardType, amenities: input.amenities } });
      await tx.bed.updateMany({ where: { room: { wardId: id }, status: { not: "OCCUPIED" } }, data: { dailyRate: input.dailyRate } });
      return ward;
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "wards", entityType: "Ward", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async deleteWard(actor: AccessTokenPayload, id: string, req?: Request) {
    const existing = await prisma.ward.findUnique({ where: { id }, include: { rooms: { include: { beds: true } } } });
    if (!existing) throw new NotFoundError("Ward not found");
    const hasAdmissions = existing.rooms.some((room) => room.beds.some((bed) => bed.status === "OCCUPIED"));
    if (hasAdmissions) throw new ConflictError("Ward type with occupied beds cannot be deleted");
    const updated = await prisma.ward.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "wards", entityType: "Ward", entityId: id, oldValues: existing, newValues: updated, req });
    return updated;
  },

  async createWard(actor: AccessTokenPayload, input: { wardName: string; wardType: string; dailyRate: number; capacity: number; amenities: string[]; isActive: boolean }, req?: Request) {
    const duplicate = await prisma.ward.findFirst({ where: { wardName: input.wardName } });
    if (duplicate) throw new ConflictError("Ward type name must be unique");
    const ward = await prisma.ward.create({ data: { ...input, wardType: input.wardType as WardType } });
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
    const room = await prisma.room.findUnique({ where: { id: input.roomId }, include: { ward: true } });
    if (!room) throw new NotFoundError("Room not found");
    const bedCount = await prisma.bed.count({ where: { room: { wardId: room.wardId } } });
    if (bedCount >= room.ward.capacity) throw new ConflictError("Ward capacity has been reached");
    const bed = await prisma.bed.create({ data: { ...input, dailyRate: input.dailyRate && input.dailyRate > 0 ? input.dailyRate : room.ward.dailyRate } });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "wards", entityType: "Bed", entityId: bed.id, newValues: bed, req });
    return bed;
  },

  async bulkUpdateRoomBeds(actor: AccessTokenPayload, input: {
    roomUpdates: Array<{ id: string; wardId: string; roomNumber: string }>;
    bedUpdates: Array<{ id: string; roomId?: string; wardId?: string; bedNumber: string; bedLabel?: string | null }>;
    deleteBedIds: string[];
    addBeds: Array<{ wardId: string; roomNumber: string; bedNumbers: string[] }>;
  }, req?: Request) {
    const result = await prisma.$transaction(async (tx) => {
      const occupiedDeletes = await tx.bed.findMany({ where: { id: { in: input.deleteBedIds }, status: "OCCUPIED" }, select: { bedNumber: true } });
      if (occupiedDeletes.length) throw new ConflictError(`Cannot delete occupied bed(s): ${occupiedDeletes.map((bed) => bed.bedNumber).join(", ")}`);

      for (const roomUpdate of input.roomUpdates) {
        const ward = await tx.ward.findUnique({ where: { id: roomUpdate.wardId } });
        if (!ward) throw new NotFoundError("Ward not found");
        const duplicateRoom = await tx.room.findFirst({ where: { wardId: roomUpdate.wardId, roomNumber: roomUpdate.roomNumber, NOT: { id: roomUpdate.id } } });
        if (duplicateRoom) throw new ConflictError(`Room number ${roomUpdate.roomNumber} already exists in ${ward.wardName}`);
        await tx.room.update({ where: { id: roomUpdate.id }, data: { wardId: roomUpdate.wardId, roomNumber: roomUpdate.roomNumber } });
      }

      for (const bedUpdate of input.bedUpdates) {
        const existing = await tx.bed.findUnique({ where: { id: bedUpdate.id }, include: { room: true } });
        if (!existing) throw new NotFoundError("Bed not found");
        if (existing.status === "OCCUPIED" && (bedUpdate.roomId || bedUpdate.wardId) && bedUpdate.roomId !== existing.roomId) {
          throw new ConflictError(`Cannot reassign occupied bed ${existing.bedNumber}`);
        }
        let roomId = bedUpdate.roomId;
        if (bedUpdate.wardId) {
          const room = await tx.room.findFirst({ where: { wardId: bedUpdate.wardId, isActive: true }, orderBy: { roomNumber: "asc" } });
          roomId = room?.id;
          if (!roomId) roomId = (await tx.room.create({ data: { wardId: bedUpdate.wardId, roomNumber: "Bulk" } })).id;
        }
        const duplicateBed = await tx.bed.findFirst({ where: { roomId: roomId ?? existing.roomId, bedNumber: bedUpdate.bedNumber, NOT: { id: bedUpdate.id } } });
        if (duplicateBed) throw new ConflictError(`Bed number ${bedUpdate.bedNumber} already exists in the target room`);
        await tx.bed.update({ where: { id: bedUpdate.id }, data: { roomId, bedNumber: bedUpdate.bedNumber, bedLabel: bedUpdate.bedLabel } });
      }

      if (input.deleteBedIds.length) await tx.bed.deleteMany({ where: { id: { in: input.deleteBedIds } } });

      for (const add of input.addBeds) {
        const ward = await tx.ward.findUnique({ where: { id: add.wardId } });
        if (!ward) throw new NotFoundError("Ward not found");
        const room = await tx.room.findFirst({ where: { wardId: add.wardId, roomNumber: add.roomNumber } }) ?? await tx.room.create({ data: { wardId: add.wardId, roomNumber: add.roomNumber } });
        const currentCount = await tx.bed.count({ where: { room: { wardId: add.wardId } } });
        if (currentCount + add.bedNumbers.length > ward.capacity) throw new ConflictError(`${ward.wardName} capacity would be exceeded`);
        const duplicate = new Set<string>();
        for (const bedNumber of add.bedNumbers) {
          if (duplicate.has(bedNumber) || await tx.bed.findFirst({ where: { roomId: room.id, bedNumber } })) throw new ConflictError(`Bed number ${bedNumber} already exists in room ${add.roomNumber}`);
          duplicate.add(bedNumber);
          await tx.bed.create({ data: { roomId: room.id, bedNumber, dailyRate: ward.dailyRate } });
        }
      }
      return true;
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "wards", entityType: "RoomBedBatch", entityId: actor.sub, newValues: input, req });
    return result;
  },

  /** Live bed availability grid across all wards/rooms. */
  async bedAvailability() {
    const beds = await prisma.bed.findMany({
      where: { isActive: true, room: { ward: { isActive: true } } },
      include: {
        room: { include: { ward: true } },
        admissions: {
          where: { status: "ACTIVE" },
          include: {
            patient: true,
            attendingDoctor: { include: { user: { select: { name: true } } } },
            wardRounds: { orderBy: { roundAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: [{ room: { ward: { wardName: "asc" } } }, { bedNumber: "asc" }],
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return beds.map((bed) => ({
      ...bed,
      admissions: bed.admissions.map((admission) => ({
        ...admission,
        roundDoneToday: admission.wardRounds.some((round) =>
          new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(round.roundAt) === today
        ),
      })),
    }));
  },

  async listAdmissions(actor: AccessTokenPayload, params: PageParams & { status?: string; patientId?: string }) {
    const actorDoctorId = await getActorDoctorId(actor);
    const where: Prisma.AdmissionWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(actorDoctorId ? { attendingDoctorId: actorDoctorId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.admission.findMany({ where, skip: params.skip, take: params.limit, include: { patient: { include: { invoices: { where: { status: { not: "VOID" } }, select: { balanceAmount: true } }, ledgerEntries: { select: { amount: true } } } }, attendingDoctor: { include: { user: { select: { id: true, name: true } } } }, bed: { include: { room: { include: { ward: true } } } } }, orderBy: { admissionDate: "desc" } }),
      prisma.admission.count({ where }),
    ]);
    return {
      items: items.map((admission) => {
        const outstandingBalance = admission.patient.invoices.reduce((sum, invoice) => sum + Number(invoice.balanceAmount), 0) -
          admission.patient.ledgerEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
        const { invoices: _invoices, ledgerEntries: _ledgerEntries, ...patient } = admission.patient;
        return { ...admission, patient, outstandingBalance };
      }),
      total,
    };
  },

  async getAdmission(actor: AccessTokenPayload, id: string) {
    const admission = await prisma.admission.findUnique({
      where: { id },
      include: {
        patient: { include: { invoices: { where: { status: { not: "VOID" } }, select: { balanceAmount: true } }, ledgerEntries: { select: { amount: true } } } },
        bed: { include: { room: { include: { ward: true } } } },
        attendingDoctor: { include: { user: { select: { id: true, name: true } } } },
        transfers: true,
        vitalsHistory: true,
        nursingTasks: true,
      },
    });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    const outstandingBalance = admission.patient.invoices.reduce((sum, invoice) => sum + Number(invoice.balanceAmount), 0) -
      admission.patient.ledgerEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const { invoices: _invoices, ledgerEntries: _ledgerEntries, ...patient } = admission.patient;
    return { ...admission, patient, outstandingBalance };
  },

  async getDischargePrintData(actor: AccessTokenPayload, id: string) {
    const admission = await prisma.admission.findUnique({
      where: { id },
      include: {
        patient: true,
        bed: { include: { room: { include: { ward: true } } } },
        attendingDoctor: {
          select: {
            specialization: true,
            user: { select: { id: true, name: true, staffProfile: { select: { signatureUrl: true, stampUrl: true } } } },
          },
        },
      },
    });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    const [surgeries, labOrders, ultrasoundReports, ultrasoundOrders, invoices, deposits] = await Promise.all([
      prisma.surgery.findMany({
        where: { patientId: admission.patientId, status: { in: ["COMPLETED", "RECOVERY", "IN_PROGRESS"] } },
        orderBy: { scheduledStart: "desc" },
        include: { surgeon: { select: { specialization: true, user: { select: { name: true } } } } },
      }),
      prisma.labOrder.findMany({
        where: { patientId: admission.patientId },
        orderBy: { orderedAt: "desc" },
        take: 10,
        include: { test: { select: { testName: true } }, results: { orderBy: { createdAt: "desc" } } },
      }),
      prisma.ultrasoundReport.findMany({
        where: { patientId: admission.patientId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
      prisma.ultrasoundOrder.findMany({
        where: { patientId: admission.patientId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
      prisma.invoice.findMany({ where: { patientId: admission.patientId, status: { not: "VOID" } }, select: { balanceAmount: true } }),
      prisma.patientLedgerEntry.aggregate({ where: { patientId: admission.patientId }, _sum: { amount: true } }),
    ]);
    return {
      admission,
      procedures: surgeries,
      labResults: labOrders.flatMap((order) => order.results.map((result) => ({ ...result, testName: order.test.testName, orderedAt: order.orderedAt }))),
      ultrasoundResults: [
        ...ultrasoundReports.map((report) => ({ id: report.id, examinationType: report.examinationType, conclusion: report.conclusion, completedAt: report.completedAt })),
        ...ultrasoundOrders.map((order) => ({ id: order.id, examinationType: order.examType, conclusion: order.impression || order.findings, completedAt: order.completedAt })),
      ],
      outstandingBalance: invoices.reduce((total, invoice) => total + Number(invoice.balanceAmount), 0) - Number(deposits._sum.amount ?? 0),
    };
  },

  /** Admits a patient: bed must be AVAILABLE. Sets bed to OCCUPIED atomically. */
  async admit(actor: AccessTokenPayload, input: { patientId: string; bedId: string; attendingDoctorId: string; admissionType: string; admissionReason: string; depositAmount?: number; dailyRate?: number; expectedStayDays?: number; admissionNotes?: string }, req?: Request) {
    if (input.dailyRate !== undefined && actor.role !== "ADMIN" && actor.role !== "DOCTOR") {
      throw new ForbiddenError("Only administrators can override an admission daily rate");
    }
    const depositAmount = actor.role === "DOCTOR" ? 0 : input.depositAmount ?? 0;
    const dailyRate = actor.role === "DOCTOR" ? undefined : input.dailyRate;
    await assertDoctorCanAdmitPatient(actor, input.patientId, input.attendingDoctorId);
    const bed = await prisma.bed.findUnique({ where: { id: input.bedId } });
    if (!bed) throw new NotFoundError("Bed not found");
    if (bed.status !== "AVAILABLE") throw new ConflictError(`Bed ${bed.bedNumber} is no longer available`);

    const admission = await prisma.$transaction(async (tx) => {
      const activeAdmission = await tx.admission.findFirst({
        where: { patientId: input.patientId, status: "ACTIVE" },
        select: { id: true },
      });
      if (activeAdmission) throw new ConflictError("Patient already has an active admission");

      const claimedBed = await tx.bed.updateMany({
        where: { id: input.bedId, status: "AVAILABLE" },
        data: { status: "OCCUPIED" },
      });
      if (claimedBed.count !== 1) throw new ConflictError(`Bed ${bed.bedNumber} is no longer available`);
      const created = await tx.admission.create({
        data: {
          patientId: input.patientId,
          bedId: input.bedId,
          attendingDoctorId: input.attendingDoctorId,
          admissionType: input.admissionType as never,
          admissionReason: input.admissionReason,
          admissionNotes: input.admissionNotes,
          depositAmount,
          depositStatus: depositAmount > 0 ? "PAID" : "PENDING",
          dailyRate: dailyRate ?? bed.dailyRate,
          createdBy: actor.sub,
        },
      });
      if (depositAmount > 0) {
        await tx.patientLedgerEntry.create({
          data: {
            patientId: input.patientId,
            admissionId: created.id,
            type: "ADVANCE_DEPOSIT",
            amount: depositAmount,
            paymentMethod: "CASH",
            notes: "Advance deposit",
            createdBy: actor.sub,
          },
        });
      }
      await writeAuditLog({ userId: actor.sub, action: "ADMIT", module: "wards", entityType: "Admission", entityId: created.id, newValues: created, req }, tx);
      return created;
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Patient already has an active admission");
      }
      throw error;
    });

    return admission;
  },

  async recordAdmissionDeposit(actor: AccessTokenPayload, admissionId: string, input: { amount: number; paymentMethod: string; notes?: string }, req?: Request) {
    const admission = await prisma.admission.findUnique({
      where: { id: admissionId },
      select: { id: true, patientId: true, status: true, depositAmount: true, depositStatus: true },
    });
    if (!admission) throw new NotFoundError("Admission not found");
    if (admission.status !== "ACTIVE") throw new ConflictError("A deposit can only be recorded for an active admission");
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.admission.update({
        where: { id: admissionId },
        data: { depositAmount: { increment: input.amount }, depositStatus: "PAID" },
      });
      await tx.patientLedgerEntry.create({
        data: {
          patientId: admission.patientId,
          admissionId,
          type: "ADVANCE_DEPOSIT",
          amount: input.amount,
          paymentMethod: input.paymentMethod as never,
          notes: input.notes?.trim() || "Advance deposit",
          createdBy: actor.sub,
        },
      });
      await writeAuditLog({
        userId: actor.sub,
        action: "UPDATE",
        module: "wards",
        entityType: "Admission",
        entityId: admissionId,
        oldValues: { depositAmount: admission.depositAmount, depositStatus: admission.depositStatus },
        newValues: { depositAmount: result.depositAmount, depositStatus: result.depositStatus, paymentAmount: input.amount, paymentMethod: input.paymentMethod },
        req,
      }, tx);
      return result;
    });
    return updated;
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
      const adm = await tx.admission.update({ where: { id: admissionId }, data: { bedId: toBedId, dailyRate: toBed.dailyRate } });
      await writeAuditLog({ userId: actor.sub, action: "TRANSFER", module: "wards", entityType: "Admission", entityId: admissionId, newValues: transfer, req }, tx);
      return adm;
    });

    return updated;
  },

  /** Discharges a patient: admission -> DISCHARGED, bed -> CLEANING (must be manually set AVAILABLE after cleaning). */
  async discharge(actor: AccessTokenPayload, admissionId: string, input: {
    diagnosis: string;
    courseInHospital: string;
    medications: string[];
    conditionAtDischarge: string;
    followUpDate?: string;
    referral: string;
    instructions: string;
    confirmUnpaidBalance: boolean;
  }, req?: Request) {
    const admission = await prisma.admission.findUnique({
      where: { id: admissionId },
      include: { patient: { include: { invoices: { where: { status: { not: "VOID" } }, select: { balanceAmount: true } }, ledgerEntries: { select: { amount: true } } } } },
    });
    if (!admission) throw new NotFoundError("Admission not found");
    await assertDoctorOwns(actor, admission.attendingDoctorId);
    if (admission.status !== "ACTIVE") throw new ConflictError("Admission is not active");
    const outstandingBalance = admission.patient.invoices.reduce((total, invoice) => total + Number(invoice.balanceAmount), 0) -
      admission.patient.ledgerEntries.reduce((total, entry) => total + Number(entry.amount), 0);
    if (outstandingBalance > 0 && !input.confirmUnpaidBalance) {
      throw new ConflictError("An unpaid balance remains. Confirm discharge with the balance pending.");
    }
    const dischargeDate = new Date();
    const completedSurgeries = await prisma.surgery.findMany({
      where: { patientId: admission.patientId, status: "COMPLETED" },
      orderBy: { actualEndAt: "desc" },
      select: { surgeryType: true, actualEndAt: true },
    });
    const dischargeDetails = {
      diagnosis: input.diagnosis,
      courseInHospital: input.courseInHospital,
      procedures: completedSurgeries.map((surgery) => surgery.surgeryType),
      medications: input.medications,
      conditionAtDischarge: input.conditionAtDischarge,
      followUpDate: input.followUpDate ?? null,
      referral: input.referral,
      instructions: input.instructions,
    };

    const updated = await prisma.$transaction(async (tx) => {
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: "CLEANING" } });
      const adm = await tx.admission.update({
        where: { id: admissionId },
        data: {
          status: "DISCHARGED",
          dischargeDate,
          dischargeSummary: input.diagnosis,
          dischargeNotes: input.instructions,
          dischargeDetails,
        },
      });
      await writeAuditLog({ userId: actor.sub, action: "DISCHARGE", module: "wards", entityType: "Admission", entityId: admissionId, newValues: adm, req }, tx);
      return adm;
    });

    return updated;
  },

  async setBedStatus(actor: AccessTokenPayload, bedId: string, status: BedStatus, req?: Request) {
    const bed = await prisma.bed.findUnique({ where: { id: bedId } });
    if (!bed) throw new NotFoundError("Bed not found");
    assertBedStatusTransitionAllowed(bed.status, status);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.bed.update({ where: { id: bedId }, data: { status } });
      await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "wards", entityType: "Bed", entityId: bedId, oldValues: { status: bed.status }, newValues: { status }, req }, tx);
      return updated;
    });
  },
};
