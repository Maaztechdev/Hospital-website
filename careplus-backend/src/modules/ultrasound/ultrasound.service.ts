import { Prisma, UltrasoundOrderStatus } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { getActorDoctorId } from "@common/utils/recordAuthorization";

async function getActorUltrasoundDoctorId(actor: AccessTokenPayload): Promise<string> {
  const doctor = await prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!doctor) throw new ConflictError("Doctor profile not found");
  return doctor.id;
}

const include = {
  patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
  doctor: { include: { user: { select: { name: true } } } },
  technician: { select: { id: true, name: true, email: true } },
} as const;

async function findOrder(id: string) {
  const order = await prisma.ultrasoundOrder.findUnique({ where: { id }, include });
  if (!order) throw new NotFoundError("Ultrasound order not found");
  return order;
}

async function transition(actor: AccessTokenPayload, id: string, status: UltrasoundOrderStatus, data: Prisma.UltrasoundOrderUpdateInput = {}, req?: Request) {
  const order = await findOrder(id);
  const allowed: Record<UltrasoundOrderStatus, UltrasoundOrderStatus[]> = {
    ORDERED: ["SCHEDULED", "CANCELLED"],
    SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (!allowed[order.status].includes(status)) throw new ConflictError(`Cannot move ultrasound order from ${order.status} to ${status}`);
  const updated = await prisma.ultrasoundOrder.update({ where: { id }, data: { ...data, status } });
  await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "ultrasound", entityType: "UltrasoundOrder", entityId: id, oldValues: { status: order.status }, newValues: { status }, req });
  return updated;
}

export const ultrasoundService = {
  async listReportTemplates() {
    return prisma.ultrasoundReportTemplate.findMany({ where: { isActive: true }, orderBy: { examinationType: "asc" } });
  },

  async getReportTemplate(id: string) {
    const template = await prisma.ultrasoundReportTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("Ultrasound report template not found");
    return template;
  },

  async createReportOrder(actor: AccessTokenPayload, input: { patientId: string; examinationType: string; appointmentId?: string; notes?: string }, req?: Request) {
    const doctorId = await getActorDoctorId(actor);
    if (!doctorId) throw new ConflictError("Doctor profile not found");

    const patient = await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, mrNumber: true, firstName: true, lastName: true, age: true, gender: true } });
    if (!patient) throw new NotFoundError("Patient not found");

    const template = await prisma.ultrasoundReportTemplate.findFirst({ where: { examinationType: input.examinationType, isActive: true } });
    const report = await prisma.ultrasoundReport.create({
      data: {
        patientId: input.patientId,
        appointmentId: input.appointmentId ?? null,
        orderedByDoctorId: doctorId,
        templateId: template?.id ?? null,
        examinationType: input.examinationType,
        patientSnapshot: {
          id: patient.id,
          mrNumber: patient.mrNumber,
          firstName: patient.firstName,
          lastName: patient.lastName,
          age: patient.age,
          gender: patient.gender,
        },
        sectionValues: {},
        conclusion: input.notes ?? null,
        status: "PENDING",
      },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        orderedByDoctor: { include: { user: { select: { name: true } } } },
        template: true,
      },
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "ultrasound", entityType: "UltrasoundReport", entityId: report.id, newValues: report, req });
    return report;
  },

  async listQueue(actor: AccessTokenPayload) {
    const queue = await prisma.ultrasoundReport.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        orderedByDoctor: { include: { user: { select: { name: true } } } },
        performedByUser: { select: { id: true, name: true, email: true } },
        template: true,
      },
    });

    if (actor.role === "DOCTOR") {
      return queue.filter((item) => item.orderedByDoctor.userId === actor.sub || item.status === "PENDING");
    }
    return queue;
  },

  async getReport(actor: AccessTokenPayload, id: string) {
    const report = await prisma.ultrasoundReport.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        orderedByDoctor: { include: { user: { select: { name: true } } } },
        performedByUser: { select: { id: true, name: true, email: true } },
        template: true,
      },
    });
    if (!report) throw new NotFoundError("Ultrasound report not found");
    if (actor.role === "DOCTOR" && report.orderedByDoctor.userId !== actor.sub) throw new ConflictError("You are not authorized to view this report");
    return report;
  },

  async saveReport(actor: AccessTokenPayload, id: string, input: { examinationType?: string; sectionValues?: Record<string, unknown>; conclusion?: string; status?: "PENDING" | "COMPLETED" }, req?: Request) {
    const existing = await prisma.ultrasoundReport.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Ultrasound report not found");

    const sectionValues = (input.sectionValues ?? existing.sectionValues ?? {}) as Prisma.InputJsonValue;

    const updated = await prisma.ultrasoundReport.update({
      where: { id },
      data: {
        examinationType: input.examinationType ?? existing.examinationType,
        sectionValues,
        conclusion: input.conclusion ?? existing.conclusion ?? undefined,
        status: input.status ?? existing.status,
        completedAt: input.status === "COMPLETED" ? new Date() : existing.completedAt,
        performedByUserId: actor.sub,
      },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        orderedByDoctor: { include: { user: { select: { name: true } } } },
        performedByUser: { select: { id: true, name: true, email: true } },
        template: true,
      },
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "ultrasound", entityType: "UltrasoundReport", entityId: id, oldValues: { status: existing.status }, newValues: { status: updated.status }, req });
    return updated;
  },

  async list(actor: AccessTokenPayload, params: { skip: number; limit: number; status?: UltrasoundOrderStatus; patientId?: string; technicianId?: string; from?: Date; to?: Date }) {
    const where: Prisma.UltrasoundOrderWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.technicianId ? { technicianId: params.technicianId } : {}),
      ...(params.from || params.to ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.ultrasoundOrder.findMany({ where, skip: params.skip, take: params.limit, include, orderBy: { createdAt: "desc" } }),
      prisma.ultrasoundOrder.count({ where }),
    ]);
    return { items, total };
  },

  async getById(id: string) { return findOrder(id); },

  async listPatientHistory(patientId: string) {
    return prisma.ultrasoundOrder.findMany({ where: { patientId }, include, orderBy: { createdAt: "desc" } });
  },

  async create(actor: AccessTokenPayload, input: { patientId: string; examType: string; priority?: string; notes?: string; consultationId?: string }, req?: Request) {
    const doctorId = actor.role === "RADIOLOGIST" ? await getActorUltrasoundDoctorId(actor) : await getActorDoctorId(actor);
    if (!doctorId) throw new ConflictError("Doctor profile not found");
    const order = await prisma.ultrasoundOrder.create({ data: { patientId: input.patientId, doctorId, examType: input.examType, priority: (input.priority as never) ?? "ROUTINE", notes: input.notes, consultationId: input.consultationId } });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "ultrasound", entityType: "UltrasoundOrder", entityId: order.id, newValues: order, req });
    return order;
  },

  async schedule(actor: AccessTokenPayload, id: string, input: { scheduledAt: Date; technicianId?: string }, req?: Request) {
    return transition(actor, id, "SCHEDULED", { scheduledAt: input.scheduledAt, technician: input.technicianId ? { connect: { id: input.technicianId } } : undefined }, req);
  },
  async start(actor: AccessTokenPayload, id: string, req?: Request) {
    return transition(actor, id, "IN_PROGRESS", { performedAt: new Date() }, req);
  },
  async complete(actor: AccessTokenPayload, id: string, input: { findings: string; impression: string; imageUrls?: string[] }, req?: Request) {
    return transition(actor, id, "COMPLETED", { findings: input.findings, impression: input.impression, imageUrls: input.imageUrls ?? [], completedAt: new Date() }, req);
  },
  async addImages(actor: AccessTokenPayload, id: string, imageUrls: string[], req?: Request) {
    const order = await findOrder(id);
    const updated = await prisma.ultrasoundOrder.update({ where: { id }, data: { imageUrls: { push: imageUrls } } });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "ultrasound", entityType: "UltrasoundOrder", entityId: id, newValues: { imageCount: imageUrls.length }, req });
    return { ...updated, imageUrls: [...order.imageUrls, ...imageUrls] };
  },
  async cancel(actor: AccessTokenPayload, id: string, req?: Request) {
    return transition(actor, id, "CANCELLED", {}, req);
  },
};
