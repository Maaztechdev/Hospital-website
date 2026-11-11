import { AuditAction, Prisma, UltrasoundOrderStatus } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { getActorDoctorId } from "@common/utils/recordAuthorization";
import { notifyUser } from "@common/utils/notify";
import { generateDepartmentInvoiceNumber } from "@common/utils/sequenceGenerators";
import { assertAmendmentReason, assertUltrasoundTransitionAllowed } from "./ultrasoundWorkflow";
import { addIpdChargeInTransaction } from "@modules/ipd/ipdBilling.service";
import { roundMoney, aggregatePaymentTotals } from "@common/utils/money";

async function getActorUltrasoundDoctorId(actor: AccessTokenPayload): Promise<string> {
  const doctor = await prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!doctor) throw new ConflictError("Doctor profile not found");
  return doctor.id;
}

const include = {
  patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true, age: true, gender: true } },
  doctor: { include: { user: { select: { name: true } } } },
  technician: { select: { id: true, name: true, email: true } },
  verifiedBy: { select: { id: true, name: true, doctorProfile: { select: { signatureUrl: true } } } },
  amendments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" as const } },
  invoice: { select: { id: true, invoiceNumber: true, status: true, grandTotal: true, paidAmount: true, balanceAmount: true } },
} as const;

const performerRoles = ["ADMIN", "DOCTOR", "RADIOLOGIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN"] as const;
const _technicianRoles = ["ADMIN", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN"] as const;
const reviewerRoles = ["ADMIN", "DOCTOR", "RADIOLOGIST"] as const;
const deliveryRoles = ["ADMIN", "RECEPTIONIST"] as const;

function requireRole(actor: AccessTokenPayload, roles: readonly string[]) {
  if (!roles.includes(actor.role)) throw new ForbiddenError("You are not authorized to perform this ultrasound action");
}

async function findOrder(id: string) {
  const order = await prisma.ultrasoundOrder.findUnique({ where: { id }, include });
  if (!order) throw new NotFoundError("Ultrasound order not found");
  return order;
}

async function transition(actor: AccessTokenPayload, id: string, status: UltrasoundOrderStatus, data: Prisma.UltrasoundOrderUncheckedUpdateManyInput = {}, req?: Request) {
  const allowedRoles = status === "SCHEDULED" || status === "IN_PROGRESS" || status === "REPORTED"
    ? performerRoles
    : status === "VERIFIED" || status === "FINALIZED"
      ? reviewerRoles
      : deliveryRoles;
  requireRole(actor, allowedRoles);
  const order = await findOrder(id);
  assertUltrasoundTransitionAllowed(order.status, status);
  if ((status === "IN_PROGRESS" || status === "REPORTED") && actor.role !== "ADMIN" && actor.role !== "DOCTOR" && actor.role !== "RADIOLOGIST" && order.technicianId && order.technicianId !== actor.sub) {
    throw new ForbiddenError("Only the assigned ultrasound clinician or technician can work on this order");
  }
  if (!order.technicianId && !data.technicianId && (status === "IN_PROGRESS" || status === "REPORTED")) {
    data.technicianId = actor.sub;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.ultrasoundOrder.updateMany({ where: { id, status: order.status }, data: { ...data, status } });
    if (changed.count !== 1) throw new ConflictError("Ultrasound order status changed; refresh and try again");
    const saved = await tx.ultrasoundOrder.findUnique({ where: { id }, include });
    if (!saved) throw new NotFoundError("Ultrasound order not found");
    if (status === "SCHEDULED" && inputTechnicianChanged(order.technicianId, saved.technicianId)) {
      if (!saved.technicianId) throw new ConflictError("An ultrasound technician must be assigned");
      await notifyUser({
        userId: saved.technicianId,
        notificationType: "ULTRASOUND_ASSIGNED",
        title: "Ultrasound order assigned",
        message: `${saved.examType} scan assigned for ${saved.patient.firstName} ${saved.patient.lastName}.`,
        relatedEntityType: "UltrasoundOrder",
        relatedEntityId: id,
        variables: {
          examType: saved.examType,
          patientName: `${saved.patient.firstName} ${saved.patient.lastName}`.trim(),
          orderId: id,
        },
      }, tx);
    }
    if (status === "REPORTED") {
      await notifyUser({
        userId: saved.doctor.userId,
        notificationType: "ULTRASOUND_REPORT_READY",
        title: "Ultrasound report ready for verification",
        message: `${saved.examType} report for ${saved.patient.firstName} ${saved.patient.lastName} is ready to review.`,
        relatedEntityType: "UltrasoundOrder",
        relatedEntityId: id,
        variables: {
          examType: saved.examType,
          patientName: `${saved.patient.firstName} ${saved.patient.lastName}`.trim(),
          orderId: id,
        },
      }, tx);
    }
    const transitionAction: AuditAction = status === "SCHEDULED"
      ? "ULTRASOUND_ORDER_SCHEDULED"
      : status === "VERIFIED"
        ? "ULTRASOUND_REPORT_VERIFIED"
        : status === "CANCELLED"
          ? "ULTRASOUND_ORDER_CANCELLED"
          : "ULTRASOUND_STATUS_CHANGED";
    await writeAuditLog({
      userId: actor.sub,
      action: transitionAction,
      module: "ultrasound",
      entityType: "UltrasoundOrder",
      entityId: id,
      oldValues: { status: order.status },
      newValues: { status },
      req,
    }, tx);
    if (status === "SCHEDULED" && inputTechnicianChanged(order.technicianId, saved.technicianId)) {
      await writeAuditLog({
        userId: actor.sub,
        action: "ULTRASOUND_ORDER_ASSIGNED",
        module: "ultrasound",
        entityType: "UltrasoundOrder",
        entityId: id,
        oldValues: { technicianId: order.technicianId },
        newValues: { technicianId: saved.technicianId, technicianName: saved.technician?.name },
        req,
      }, tx);
    }
    if (status === "REPORTED") {
      await writeAuditLog({
        userId: actor.sub,
        action: "ULTRASOUND_FINDINGS_EDITED",
        module: "ultrasound",
        entityType: "UltrasoundOrder",
        entityId: id,
        oldValues: { findings: order.findings, impression: order.impression, structuredData: order.structuredData },
        newValues: {
          findings: saved.findings,
          impression: saved.impression,
          structuredData: saved.structuredData,
        },
        req,
      }, tx);
    }
    if (status === "REPORTED" && Array.isArray(data.imageUrls)) {
      const nextImageUrls = data.imageUrls as string[];
      const removedImageUrls = order.imageUrls.filter((url) => !nextImageUrls.includes(url));
      if (removedImageUrls.length) {
        await writeAuditLog({
          userId: actor.sub,
          action: "ULTRASOUND_IMAGES_REMOVED",
          module: "ultrasound",
          entityType: "UltrasoundOrder",
          entityId: id,
          oldValues: { count: order.imageUrls.length, removedCount: removedImageUrls.length },
          newValues: { count: nextImageUrls.length },
          req,
        }, tx);
      }
    }
    return saved;
  });
  return updated;
}

function inputTechnicianChanged(previousId: string | null, nextId: string | null) {
  return nextId !== null && previousId !== nextId;
}

function hospitalDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(dateKey: string, daysToAdd: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return date.toISOString().slice(0, 10);
}

function dateRange(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00+05:00`) } : {}),
    ...(to ? { lt: new Date(`${addCalendarDays(to, 1)}T00:00:00+05:00`) } : {}),
  };
}

function numeric(value: Prisma.Decimal | null | undefined) {
  return Number(value ?? 0);
}

export const ultrasoundService = {
  async listReportTemplates(includeInactive = false) {
    return prisma.ultrasoundReportTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { examinationType: "asc" },
    });
  },

  async getReportTemplate(id: string) {
    const template = await prisma.ultrasoundReportTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundError("Ultrasound report template not found");
    return template;
  },

  async updateReportTemplate(actor: AccessTokenPayload, id: string, sections: Array<Record<string, unknown>>, req?: Request) {
    const existing = await prisma.ultrasoundReportTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Ultrasound report template not found");
    const updated = await prisma.ultrasoundReportTemplate.update({
      where: { id },
      data: { sections: sections as Prisma.InputJsonValue },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "ultrasound",
      entityType: "UltrasoundReportTemplate",
      entityId: id,
      oldValues: { sections: existing.sections },
      newValues: { sections: updated.sections },
      req,
    });
    return updated;
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
      where: {
        status: "PENDING",
        ...(actor.role === "DOCTOR" ? { orderedByDoctor: { userId: actor.sub } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        patient: { select: { id: true, mrNumber: true, firstName: true, lastName: true } },
        orderedByDoctor: { include: { user: { select: { name: true } } } },
        performedByUser: { select: { id: true, name: true, email: true } },
        template: true,
      },
    });

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

  async list(actor: AccessTokenPayload, params: { skip: number; limit: number; status?: UltrasoundOrderStatus; priority?: "ROUTINE" | "URGENT" | "STAT"; examType?: string; sort?: "priority" | "time"; patientId?: string; technicianId?: string; from?: Date; to?: Date }) {
    const where: Prisma.UltrasoundOrderWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.examType ? { examType: { equals: params.examType, mode: "insensitive" } } : {}),
      ...(params.patientId ? { patientId: params.patientId } : {}),
      ...(params.technicianId ? { technicianId: params.technicianId } : {}),
      ...(params.from || params.to ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.ultrasoundOrder.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        include,
        orderBy: params.sort === "time" ? [{ createdAt: "desc" }] : [{ priority: "desc" }, { createdAt: "desc" }],
      }),
      prisma.ultrasoundOrder.count({ where }),
    ]);
    return { items, total };
  },

  async overview() {
    const today = hospitalDateKey(new Date());
    const todayRange = dateRange(today, today);
    const lastWeekStart = addCalendarDays(today, -6);
    const activeUrgentWhere: Prisma.UltrasoundOrderWhereInput = {
      priority: { in: ["URGENT", "STAT", "EMERGENCY"] },
      status: { notIn: ["DELIVERED", "CANCELLED"] },
    };
    const [todayCount, pendingCount, inProgressCount, awaitingVerificationCount, urgentCount, revenue, recentActivity, dailyRows] = await Promise.all([
      prisma.ultrasoundOrder.count({ where: { createdAt: todayRange } }),
      prisma.ultrasoundOrder.count({ where: { status: { in: ["ORDERED", "SCHEDULED"] } } }),
      prisma.ultrasoundOrder.count({ where: { status: "IN_PROGRESS" } }),
      prisma.ultrasoundOrder.count({ where: { status: "REPORTED" } }),
      prisma.ultrasoundOrder.count({ where: activeUrgentWhere }),
      Promise.all([
        prisma.payment.aggregate({
          where: {
            paymentDate: todayRange,
            type: "PAYMENT",
            deletedAt: null,
            invoice: { status: { not: "VOID" }, ultrasoundOrder: { is: { status: { not: "CANCELLED" } } } },
          },
          _sum: { amount: true },
        }),
        prisma.payment.aggregate({
          where: {
            paymentDate: todayRange,
            type: "REFUND",
            deletedAt: null,
            invoice: { status: { not: "VOID" }, ultrasoundOrder: { is: { status: { not: "CANCELLED" } } } },
          },
          _sum: { amount: true },
        }),
      ]).then(([paymentsAgg, refundsAgg]) =>
        aggregatePaymentTotals([
          { type: "PAYMENT", amount: paymentsAgg._sum.amount ?? 0 },
          { type: "REFUND", amount: refundsAgg._sum.amount ?? 0 },
        ])
      ),
      prisma.ultrasoundOrder.findMany({
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          examType: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          patient: { select: { firstName: true, lastName: true, mrNumber: true } },
        },
      }),
      prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
        SELECT timezone('Asia/Karachi', created_at)::date::text AS day, COUNT(*)::int AS count
        FROM ultrasound_orders
        WHERE created_at >= ${new Date(`${lastWeekStart}T00:00:00+05:00`)}
          AND created_at < ${new Date(`${addCalendarDays(today, 1)}T00:00:00+05:00`)}
        GROUP BY timezone('Asia/Karachi', created_at)::date
        ORDER BY day ASC
      `),
    ]);
    const dailyCounts = new Map(dailyRows.map((row) => [row.day, row.count]));
    const scansPerDay = Array.from({ length: 7 }, (_, index) => {
      const day = addCalendarDays(lastWeekStart, index);
      return { day, count: dailyCounts.get(day) ?? 0 };
    });
    return {
      stats: {
        todayScans: todayCount,
        pending: pendingCount,
        inProgress: inProgressCount,
        awaitingVerification: awaitingVerificationCount,
        urgent: urgentCount,
        todayCollected: revenue.netNumber,
      },
      recentActivity,
      scansPerDay,
    };
  },

  async analyticsReport(from?: string, to?: string) {
    const createdAt = dateRange(from, to);
    const where: Prisma.UltrasoundOrderWhereInput = {
      ...(from || to ? { createdAt } : {}),
      status: { not: "CANCELLED" },
    };
    const _turnaroundWhere: Prisma.UltrasoundOrderWhereInput = {
      ...(from || to ? { createdAt } : {}),
      status: { in: ["REPORTED", "VERIFIED", "DELIVERED"] },
      completedAt: { not: null },
    };
    const [totals, totalCount, byScanType, byTechnician, byDoctor, turnaround] = await Promise.all([
      prisma.ultrasoundOrder.aggregate({
        where,
        _sum: { feeAmount: true, discountAmount: true },
      }),
      prisma.ultrasoundOrder.count({ where }),
      prisma.ultrasoundOrder.groupBy({
        by: ["examType"],
        where,
        _count: { _all: true },
        _sum: { feeAmount: true, discountAmount: true },
        orderBy: { examType: "asc" },
      }),
      prisma.ultrasoundOrder.groupBy({
        by: ["technicianId"],
        where: { ...where, technicianId: { not: null } },
        _count: { _all: true },
        _sum: { feeAmount: true, discountAmount: true },
      }),
      prisma.ultrasoundOrder.groupBy({
        by: ["doctorId"],
        where,
        _count: { _all: true },
        _sum: { feeAmount: true, discountAmount: true },
      }),
      prisma.$queryRaw<Array<{ average_hours: number | null; sample_size: number }>>(Prisma.sql`
        SELECT
          COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)::numeric, 2), 0)::float AS average_hours,
          COUNT(*)::int AS sample_size
        FROM ultrasound_orders
        WHERE status IN ('REPORTED', 'VERIFIED', 'DELIVERED')
          AND completed_at IS NOT NULL
          ${from ? Prisma.sql`AND created_at >= ${new Date(`${from}T00:00:00+05:00`)}` : Prisma.empty}
          ${to ? Prisma.sql`AND created_at < ${new Date(`${addCalendarDays(to, 1)}T00:00:00+05:00`)}` : Prisma.empty}
      `),
    ]);
    const technicianIds = byTechnician.flatMap((row) => row.technicianId ? [row.technicianId] : []);
    const doctorIds = byDoctor.map((row) => row.doctorId);
    const [technicians, doctors] = await Promise.all([
      technicianIds.length ? prisma.user.findMany({ where: { id: { in: technicianIds } }, select: { id: true, name: true } }) : [],
      doctorIds.length ? prisma.doctor.findMany({ where: { id: { in: doctorIds } }, select: { id: true, user: { select: { name: true } } } }) : [],
    ]);
    const technicianNames = new Map(technicians.map((item) => [item.id, item.name]));
    const doctorNames = new Map(doctors.map((item) => [item.id, item.user.name]));
    const grossRevenue = numeric(totals._sum.feeAmount);
    const discountsGiven = numeric(totals._sum.discountAmount);
    const netRevenue = Math.max(0, grossRevenue - discountsGiven);
    const summarize = (count: number, fee: Prisma.Decimal | null, discount: Prisma.Decimal | null) => ({
      count,
      revenue: Math.max(0, numeric(fee) - numeric(discount)),
    });

    return {
      totalScans: totalCount,
      totalRevenue: netRevenue,
      discountsGiven,
      averageTurnaroundHours: turnaround[0]?.average_hours ?? 0,
      turnaroundSampleSize: turnaround[0]?.sample_size ?? 0,
      byScanType: byScanType.map((row) => ({
        examType: row.examType,
        ...summarize(row._count._all, row._sum.feeAmount, row._sum.discountAmount),
      })),
      byTechnician: byTechnician.flatMap((row) => row.technicianId ? [{
        technicianId: row.technicianId,
        technicianName: technicianNames.get(row.technicianId) ?? "Unknown technician",
        ...summarize(row._count._all, row._sum.feeAmount, row._sum.discountAmount),
      }] : []),
      byDoctor: byDoctor.map((row) => ({
        doctorId: row.doctorId,
        doctorName: doctorNames.get(row.doctorId) ?? "Unknown doctor",
        ...summarize(row._count._all, row._sum.feeAmount, row._sum.discountAmount),
      })),
    };
  },

  async getById(id: string) { return findOrder(id); },

  async listPatientHistory(patientId: string) {
    return prisma.ultrasoundOrder.findMany({ where: { patientId }, include, orderBy: { createdAt: "desc" } });
  },

  async create(actor: AccessTokenPayload, input: { patientId: string; examType: string; priority?: "ROUTINE" | "URGENT" | "STAT"; feeAmount?: number; discountAmount?: number; discountType?: "AMOUNT" | "PERCENTAGE"; discountReason?: string; notes?: string; consultationId?: string; admissionId?: string }, req?: Request) {
    const doctorId = actor.role === "RADIOLOGIST" ? await getActorUltrasoundDoctorId(actor) : await getActorDoctorId(actor);
    if (!doctorId) throw new ConflictError("Doctor profile not found");
    return prisma.$transaction(async (tx) => {
      const catalogSetting = await tx.setting.findUnique({ where: { key: "ultrasound.scanCatalog" } });
      const catalog = Array.isArray(catalogSetting?.value) ? catalogSetting.value as Array<{ name?: string; fee?: number; enabled?: boolean }> : [];
      const catalogItem = catalog.find((item) => item.name?.toLowerCase() === input.examType.toLowerCase());
      if (catalogItem?.enabled === false) throw new ConflictError("This ultrasound scan type is disabled");
      const feeAmount = input.feeAmount ?? Number(catalogItem?.fee ?? 0);
      const rawDiscount = input.discountAmount ?? 0;
      const discountAmount = roundMoney(input.discountType === "PERCENTAGE" ? feeAmount * rawDiscount / 100 : rawDiscount).toNumber();
      if (discountAmount > 0 && !input.discountReason?.trim()) throw new ConflictError("A reason is required for an ultrasound discount");
      if (discountAmount > feeAmount) throw new ConflictError("Discount cannot exceed the ultrasound fee");
      const admission = input.admissionId
        ? await tx.admission.findFirst({ where: { id: input.admissionId, patientId: input.patientId, status: "ACTIVE" } })
        : null;
      if (input.admissionId && !admission) throw new ConflictError("The selected admission is not active for this patient.");
      const ipdInvoice = admission ? await tx.invoice.findUnique({ where: { admissionId: admission.id } }) : null;
      if (admission && !ipdInvoice) throw new ConflictError("This admission has no IPD invoice.");
      const order = await tx.ultrasoundOrder.create({ data: {
        patientId: input.patientId,
        doctorId,
        examType: input.examType,
        priority: input.priority ?? "ROUTINE",
        feeAmount,
        discountAmount,
        notes: input.notes,
        consultationId: input.consultationId,
        admissionId: admission?.id,
      } });
      let invoice = ipdInvoice;
      if (admission && ipdInvoice) {
        await addIpdChargeInTransaction(tx, {
          admissionId: admission.id,
          itemType: "ULTRASOUND",
          description: `${input.examType} ultrasound`,
          amount: feeAmount,
          discount: discountAmount,
          sourceType: "ULTRASOUND_ORDER",
          sourceId: order.id,
          sourceDepartment: "ULTRASOUND",
          createdBy: actor.sub,
        });
      } else {
        const invoiceNumber = await generateDepartmentInvoiceNumber(tx, "ULTRASOUND");
        const grandTotal = Math.max(0, Math.round(feeAmount - discountAmount));
        invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          patientId: input.patientId,
          createdBy: actor.sub,
          department: "ULTRASOUND",
          status: grandTotal === 0 ? "PAID" : "UNPAID",
          subtotal: Math.round(feeAmount),
          discountAmount,
          discountType: discountAmount > 0 ? (input.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FLAT") : undefined,
          discountReason: input.discountReason?.trim() || undefined,
          discountAppliedBy: discountAmount > 0 ? actor.sub : undefined,
          grandTotal,
          paidAmount: 0,
          balanceAmount: grandTotal,
          items: { create: {
            itemType: "ULTRASOUND",
            description: `${input.examType} ultrasound`,
            quantity: 1,
            unitPrice: Math.round(feeAmount),
            discount: discountAmount,
            subtotal: grandTotal,
            sourceType: "ULTRASOUND_ORDER",
            sourceId: order.id,
            sourceDepartment: "ULTRASOUND",
          } },
        },
      });
      }
      if (!invoice) throw new ConflictError("Unable to link the Ultrasound order to an invoice.");
      const linkedOrder = await tx.ultrasoundOrder.update({ where: { id: order.id }, data: { invoiceId: invoice.id }, include });
      await writeAuditLog({
        userId: actor.sub,
        action: "ULTRASOUND_ORDER_CREATED",
        module: "ultrasound",
        entityType: "UltrasoundOrder",
        entityId: order.id,
        newValues: {
          patientId: order.patientId,
          examType: order.examType,
          priority: order.priority,
          status: order.status,
          feeAmount: order.feeAmount,
          discountAmount: order.discountAmount,
          invoiceId: invoice.id,
        },
        req,
      }, tx);
      return linkedOrder;
    });
  },

  async schedule(actor: AccessTokenPayload, id: string, input: { scheduledAt: Date; technicianId: string }, req?: Request) {
    requireRole(actor, performerRoles);
    const technician = await prisma.user.findFirst({ where: { id: input.technicianId, role: { in: [...performerRoles] }, isActive: true, deletedAt: null }, select: { id: true } });
    if (!technician) throw new ConflictError("Select an active ultrasound technician or performer");
    return transition(actor, id, "SCHEDULED", { scheduledAt: input.scheduledAt, technicianId: input.technicianId }, req);
  },
  async start(actor: AccessTokenPayload, id: string, req?: Request) {
    const order = await findOrder(id);
    const data: Prisma.UltrasoundOrderUncheckedUpdateManyInput = { performedAt: new Date() };
    if (!order.technicianId) {
      data.technicianId = actor.sub;
    }
    return transition(actor, id, "IN_PROGRESS", data, req);
  },
  async complete(actor: AccessTokenPayload, id: string, input: { findings: string; impression?: string; structuredData?: Record<string, unknown>; imageUrls?: string[]; imageCaptions?: string[] }, req?: Request) {
    return transition(actor, id, "REPORTED", {
      findings: input.findings,
      ...(input.impression !== undefined ? { impression: input.impression } : {}),
      ...(input.structuredData !== undefined ? { structuredData: input.structuredData as Prisma.InputJsonValue } : {}),
      ...(input.imageUrls !== undefined ? { imageUrls: input.imageUrls } : {}),
      ...(input.imageCaptions !== undefined ? { imageCaptions: input.imageCaptions } : {}),
      completedAt: new Date(),
    }, req);
  },
  async review(actor: AccessTokenPayload, id: string, input: { findings?: string; impression?: string; structuredData?: Record<string, unknown>; amendmentReason?: string; expectedUpdatedAt?: string }, req?: Request) {
    requireRole(actor, reviewerRoles);
    const order = await findOrder(id);
    if (order.status !== "IN_PROGRESS" && order.status !== "REPORTED" && order.status !== "VERIFIED") {
      throw new ConflictError("Only in-progress, reported, or verified ultrasound reports can be reviewed");
    }
    assertAmendmentReason(order.status, input.amendmentReason);

    if (!input.expectedUpdatedAt) {
      throw new BadRequestError("expectedUpdatedAt is required");
    }
    const expectedTime = new Date(input.expectedUpdatedAt).getTime();
    const actualTime = new Date(order.updatedAt).getTime();
    if (expectedTime !== actualTime) {
      throw new ConflictError("This record was changed by another user, reload");
    }

    const data: Prisma.UltrasoundOrderUncheckedUpdateManyInput = {
      ...(input.findings !== undefined ? { findings: input.findings } : {}),
      ...(input.impression !== undefined ? { impression: input.impression } : {}),
      ...(input.structuredData !== undefined ? { structuredData: input.structuredData as Prisma.InputJsonValue } : {}),
      updatedAt: new Date(),
    };
    const previousValues = {
      findings: order.findings,
      impression: order.impression,
      structuredData: order.structuredData,
    };
    const nextValues = {
      findings: input.findings ?? order.findings,
      impression: input.impression ?? order.impression,
      structuredData: input.structuredData ?? order.structuredData,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.ultrasoundOrder.updateMany({ where: { id, status: order.status, updatedAt: order.updatedAt }, data });
      if (changed.count !== 1) throw new ConflictError("This record was changed by another user, reload");
      if (order.status === "VERIFIED") {
        await tx.ultrasoundReportAmendment.create({
          data: {
            orderId: id,
            authorId: actor.sub,
            reason: input.amendmentReason!.trim(),
            oldValues: previousValues as Prisma.InputJsonValue,
            newValues: nextValues as Prisma.InputJsonValue,
          },
        });
      }
      const saved = await tx.ultrasoundOrder.findUnique({ where: { id }, include });
      if (!saved) throw new NotFoundError("Ultrasound order not found");
      await writeAuditLog({
        userId: actor.sub,
        action: order.status === "VERIFIED" ? "ULTRASOUND_REPORT_AMENDED" : "ULTRASOUND_FINDINGS_EDITED",
        module: "ultrasound",
        entityType: "UltrasoundOrder",
        entityId: id,
        oldValues: { ...previousValues, status: order.status },
        newValues: { ...nextValues, status: saved.status, amended: order.status === "VERIFIED" },
        reason: order.status === "VERIFIED" ? input.amendmentReason!.trim() : null,
        req,
      }, tx);
      return saved;
    });
    return updated;
  },
  async verify(actor: AccessTokenPayload, id: string, req?: Request) {
    requireRole(actor, reviewerRoles);
    const order = await findOrder(id);
    if (!order.impression?.trim()) throw new ConflictError("Add an impression before verifying the ultrasound report");
    const user = await prisma.user.findUnique({ where: { id: actor.sub }, select: { name: true } });
    if (!user) throw new NotFoundError("Verifying user not found");
    return transition(actor, id, "VERIFIED", {
      verifiedById: actor.sub,
      verifiedByName: user.name,
      verifiedAt: new Date(),
    }, req);
  },
  async deliver(actor: AccessTokenPayload, id: string, req?: Request) {
    return transition(actor, id, "DELIVERED", {}, req);
  },
  async finalize(actor: AccessTokenPayload, id: string, req?: Request) {
    requireRole(actor, reviewerRoles);
    return transition(actor, id, "FINALIZED", {}, req);
  },
  async addImages(actor: AccessTokenPayload, id: string, imageUrls: string[], req?: Request) {
    const order = await findOrder(id);
    requireRole(actor, performerRoles);
    if (order.status !== "IN_PROGRESS" || (actor.role !== "ADMIN" && actor.role !== "DOCTOR" && actor.role !== "RADIOLOGIST" && order.technicianId && order.technicianId !== actor.sub)) {
      throw new ConflictError("Images can only be added while the scan is in progress");
    }
    return prisma.$transaction(async (tx) => {
      const changed = await tx.ultrasoundOrder.updateMany({
        where: { id, status: "IN_PROGRESS", updatedAt: order.updatedAt },
        data: { imageUrls: { push: imageUrls }, ...(order.technicianId ? {} : { technicianId: actor.sub }) },
      });
      if (changed.count !== 1) throw new ConflictError("Ultrasound order changed; refresh before adding images");
      const updated = await tx.ultrasoundOrder.findUnique({ where: { id }, include });
      if (!updated) throw new NotFoundError("Ultrasound order not found");
      await writeAuditLog({
        userId: actor.sub,
        action: "ULTRASOUND_IMAGES_ADDED",
        module: "ultrasound",
        entityType: "UltrasoundOrder",
        entityId: id,
        oldValues: { count: order.imageUrls.length },
        newValues: { count: updated.imageUrls.length, addedCount: imageUrls.length },
        req,
      }, tx);
      return updated;
    });
  },
  async updatePricing(actor: AccessTokenPayload, id: string, input: { feeAmount: number; discountAmount: number; reason?: string }, req?: Request) {
    requireRole(actor, ["ADMIN"]);
    const order = await findOrder(id);
    const nextValues = { feeAmount: input.feeAmount, discountAmount: input.discountAmount };
    const previousValues = { feeAmount: numeric(order.feeAmount), discountAmount: numeric(order.discountAmount) };
    return prisma.$transaction(async (tx) => {
      if (input.discountAmount > 0 && !input.reason?.trim()) throw new ConflictError("A reason is required for an ultrasound discount");
      if (order.invoiceId) {
        const invoice = await tx.invoice.findUnique({ where: { id: order.invoiceId } });
        if (!invoice) throw new NotFoundError("Linked ultrasound invoice not found");
        const grandTotal = Math.max(0, Math.round(input.feeAmount - input.discountAmount));
        if (grandTotal < Number(invoice.paidAmount)) throw new ConflictError("The new total cannot be lower than the amount already paid");
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            subtotal: Math.round(input.feeAmount),
            discountAmount: Math.round(input.discountAmount),
            discountReason: input.discountAmount > 0 ? input.reason!.trim() : null,
            grandTotal,
            balanceAmount: grandTotal - Number(invoice.paidAmount),
            status: grandTotal === Number(invoice.paidAmount) ? "PAID" : Number(invoice.paidAmount) > 0 ? "PARTIAL" : "UNPAID",
            items: { updateMany: { where: { invoiceId: invoice.id }, data: { unitPrice: Math.round(input.feeAmount), discount: Math.round(input.discountAmount), subtotal: grandTotal } } },
          },
        });
      }
      const changed = await tx.ultrasoundOrder.updateMany({
        where: { id, updatedAt: order.updatedAt },
        data: nextValues,
      });
      if (changed.count !== 1) throw new ConflictError("Ultrasound order changed; refresh before updating its price");
      const updated = await tx.ultrasoundOrder.findUnique({ where: { id }, include });
      if (!updated) throw new NotFoundError("Ultrasound order not found");
      if (previousValues.feeAmount !== input.feeAmount || previousValues.discountAmount !== input.discountAmount) {
        await writeAuditLog({
          userId: actor.sub,
          action: "ULTRASOUND_PRICE_DISCOUNT_CHANGED",
          module: "ultrasound",
          entityType: "UltrasoundOrder",
          entityId: id,
          oldValues: previousValues,
          newValues: nextValues,
          reason: input.reason,
          req,
        }, tx);
      }
      return updated;
    });
  },
  async logReportPrint(actor: AccessTokenPayload, id: string, req?: Request) {
    const order = await findOrder(id);
    if (!["REPORTED", "VERIFIED", "DELIVERED"].includes(order.status)) {
      throw new ConflictError("Only reported ultrasound reports can be printed");
    }
    const printCount = await prisma.auditLog.count({
      where: { module: "ultrasound", entityType: "UltrasoundOrder", entityId: id, action: "ULTRASOUND_REPORT_PRINTED" },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "ULTRASOUND_REPORT_PRINTED",
      module: "ultrasound",
      entityType: "UltrasoundOrder",
      entityId: id,
      newValues: { printNumber: printCount + 1, reprint: printCount > 0 },
      req,
    });
    return { printNumber: printCount + 1 };
  },
  async listAuditTrail(input: {
    page: number;
    limit: number;
    from?: string;
    to?: string;
    userId?: string;
    action?: AuditAction;
    search?: string;
  }) {
    const search = input.search?.trim();
    const matchingOrders = search ? await prisma.ultrasoundOrder.findMany({
      where: {
        OR: [
          { examType: { contains: search, mode: "insensitive" } },
          { patient: { firstName: { contains: search, mode: "insensitive" } } },
          { patient: { lastName: { contains: search, mode: "insensitive" } } },
          { patient: { mrNumber: { contains: search, mode: "insensitive" } } },
        ],
      },
      select: { id: true },
    }) : [];
    const matchingActions = search
      ? (Object.values(AuditAction) as AuditAction[]).filter((action) => action.toLowerCase().includes(search.toLowerCase()))
      : [];
    const where: Prisma.AuditLogWhereInput = {
      module: "ultrasound",
      entityType: "UltrasoundOrder",
      ...(input.from || input.to ? { createdAt: dateRange(input.from, input.to) } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(search ? {
        OR: [
          { entityId: { contains: search, mode: "insensitive" } },
          { user: { name: { contains: search, mode: "insensitive" } } },
          ...(matchingOrders.length ? [{ entityId: { in: matchingOrders.map((order) => order.id) } }] : []),
          ...(matchingActions.length ? [{ action: { in: matchingActions } }] : []),
        ],
      } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    const orderIds = [...new Set(items.flatMap((item) => item.entityId ? [item.entityId] : []))];
    const orders = orderIds.length ? await prisma.ultrasoundOrder.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        examType: true,
        patient: { select: { firstName: true, lastName: true, mrNumber: true } },
      },
    }) : [];
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    return {
      items: items.map((item) => ({ ...item, order: item.entityId ? ordersById.get(item.entityId) ?? null : null })),
      total,
      page: input.page,
      limit: input.limit,
    };
  },
  async listAuditUsers() {
    return prisma.user.findMany({
      where: { auditLogs: { some: { module: "ultrasound", entityType: "UltrasoundOrder" } } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
  },
  async listOrderAudit(id: string) {
    await findOrder(id);
    return prisma.auditLog.findMany({
      where: { module: "ultrasound", entityType: "UltrasoundOrder", entityId: id },
      select: {
        id: true,
        createdAt: true,
        action: true,
        userRole: true,
        reason: true,
        oldValuesJson: true,
        newValuesJson: true,
        user: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
    });
  },
  async cancel(actor: AccessTokenPayload, id: string, req?: Request) {
    return transition(actor, id, "CANCELLED", {}, req);
  },
};
