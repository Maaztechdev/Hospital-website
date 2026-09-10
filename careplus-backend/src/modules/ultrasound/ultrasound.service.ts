import { Prisma, UltrasoundOrderStatus } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { getActorDoctorId } from "@common/utils/recordAuthorization";

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
    const doctorId = await getActorDoctorId(actor);
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
