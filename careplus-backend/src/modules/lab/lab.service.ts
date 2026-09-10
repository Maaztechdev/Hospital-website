import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyRoles } from "@common/utils/notify";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { getActorDoctorId, assertDoctorOwns } from "@common/utils/recordAuthorization";

export const labService = {
  async listTests() {
    return prisma.labTest.findMany({ where: { isActive: true }, orderBy: { testName: "asc" } });
  },

  async createTest(actor: AccessTokenPayload, input: { testName: string; testCode: string; category?: string; price: number; unit?: string; referenceRangeMin?: number; referenceRangeMax?: number }, req?: Request) {
    const test = await prisma.labTest.create({ data: input });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabTest", entityId: test.id, newValues: test, req });
    return test;
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
      prisma.labOrder.findMany({ where, skip: params.skip, take: params.limit, include: { test: true, results: true }, orderBy: { orderedAt: "desc" } }),
      prisma.labOrder.count({ where }),
    ]);
    return { items, total };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    const order = await prisma.labOrder.findUnique({ where: { id }, include: { test: true, results: true, attachments: true } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    return order;
  },

  async createOrder(actor: AccessTokenPayload, input: { patientId: string; doctorId?: string; testId: string; priority?: string; sampleType?: string; clinicalNotes?: string; consultationId?: string }, req?: Request) {
    const actorDoctorId = await getActorDoctorId(actor);
    if (actorDoctorId) input.doctorId = actorDoctorId;
    const order = await prisma.labOrder.create({
      data: {
        patientId: input.patientId,
        doctorId: input.doctorId,
        testId: input.testId,
        priority: (input.priority as never) ?? "ROUTINE",
        sampleType: input.sampleType,
        clinicalNotes: input.clinicalNotes,
        createdBy: actor.sub,
        consultationId: input.consultationId,
      },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabOrder", entityId: order.id, newValues: order, req });
    return order;
  },

  async updateSampleStatus(actor: AccessTokenPayload, id: string, status: "SAMPLE_COLLECTED" | "PROCESSING" | "CANCELLED", req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (["COMPLETED", "VERIFIED", "CANCELLED"].includes(order.status)) {
      throw new ConflictError(`Cannot change sample status once order is ${order.status}`);
    }

    const data: Prisma.LabOrderUpdateInput = { status };
    if (status === "SAMPLE_COLLECTED") data.sampleCollectedAt = new Date();

    const updated = await prisma.labOrder.update({ where: { id }, data });
    await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "lab", entityType: "LabOrder", entityId: id, oldValues: { status: order.status }, newValues: { status }, req });
    return updated;
  },

  /** Enter result -> COMPLETED. CRITICAL interpretation auto-triggers a notification. */
  async enterResult(
    actor: AccessTokenPayload,
    id: string,
    input: { resultValue: string; unit?: string; referenceRange?: string; interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL"; technicianNotes?: string },
    req?: Request
  ) {
    const order = await prisma.labOrder.findUnique({ where: { id }, include: { patient: true, test: true } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (["COMPLETED", "VERIFIED", "CANCELLED"].includes(order.status)) {
      throw new ConflictError(`Cannot enter results — order status is ${order.status}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.labResult.create({
        data: {
          labOrderId: id,
          resultValue: input.resultValue,
          unit: input.unit,
          referenceRange: input.referenceRange,
          interpretation: input.interpretation as never,
          technicianNotes: input.technicianNotes,
        },
      });
      await tx.labOrder.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });

      if (input.interpretation === "CRITICAL") {
        await notifyRoles(
          ["DOCTOR", "ADMIN"],
          {
            notificationType: "CRITICAL_LAB_RESULT",
            title: "CRITICAL lab result",
            message: `${order.test.testName} for patient ${order.patient.firstName} ${order.patient.lastName} is CRITICAL`,
            relatedEntityType: "LabOrder",
            relatedEntityId: id,
          },
          tx
        );
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

      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabResult", entityId: created.id, newValues: created, req }, tx);
      return created;
    });

    return result;
  },

  /** Amend keeps full history — supersedes old result, never overwrites in place. */
  async amendResult(
    actor: AccessTokenPayload,
    labOrderId: string,
    input: { resultValue: string; unit?: string; referenceRange?: string; interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL"; technicianNotes?: string; reason: string },
    req?: Request
  ) {
    const previous = await prisma.labResult.findFirst({ where: { labOrderId }, orderBy: { createdAt: "desc" } });
    if (!previous) throw new NotFoundError("No existing result to amend");
    const order = await prisma.labOrder.findUnique({ where: { id: labOrderId }, select: { doctorId: true } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);

    const amended = await prisma.$transaction(async (tx) => {
      const created = await tx.labResult.create({
        data: {
          labOrderId,
          resultValue: input.resultValue,
          unit: input.unit,
          referenceRange: input.referenceRange,
          interpretation: input.interpretation as never,
          technicianNotes: input.technicianNotes,
          amendmentReason: input.reason,
        },
      });
      await tx.labResult.update({ where: { id: previous.id }, data: { supersededById: created.id } });
      await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab", entityType: "LabResult", entityId: created.id, oldValues: previous, newValues: created, req }, tx);
      return created;
    });

    return amended;
  },

  async verify(actor: AccessTokenPayload, id: string, req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);
    if (order.status !== "COMPLETED") throw new ConflictError("Only COMPLETED orders can be verified");

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.labResult.findFirst({ where: { labOrderId: id, supersededById: null }, orderBy: { createdAt: "desc" } });
      if (result) {
        await tx.labResult.update({ where: { id: result.id }, data: { verifiedBy: actor.sub, verifiedAt: new Date() } });
      }
      return tx.labOrder.update({ where: { id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
    });

    await writeAuditLog({ userId: actor.sub, action: "VERIFY", module: "lab", entityType: "LabOrder", entityId: id, newValues: { status: "VERIFIED" }, req });
    return updated;
  },

  async uploadReport(actor: AccessTokenPayload, labOrderId: string, fileUrl: string, fileType: string, req?: Request) {
    const order = await prisma.labOrder.findUnique({ where: { id: labOrderId } });
    if (!order) throw new NotFoundError("Lab order not found");
    await assertDoctorOwns(actor, order.doctorId);

    const attachment = await prisma.labReportAttachment.create({
      data: { labOrderId, fileUrl, fileType, uploadedBy: actor.sub },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab", entityType: "LabReportAttachment", entityId: attachment.id, newValues: attachment, req });
    return attachment;
  },
};
