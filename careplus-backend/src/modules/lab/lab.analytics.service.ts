import { prisma } from "@config/prisma";
import { ConflictError } from "@common/errors/AppError";
import { getActorDoctorId } from "@common/utils/recordAuthorization";
import type { AccessTokenPayload } from "@common/middleware/authenticate";

export function addHospitalDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hospitalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hospitalDateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00+05:00`) } : {}),
    ...(to ? { lt: new Date(`${addHospitalDays(to, 1)}T00:00:00+05:00`) } : {}),
  };
}

export function ensureValidHospitalRange(from?: string, to?: string) {
  if ((from && !to) || (!from && to)) throw new ConflictError("Provide both custom report dates.");
  if (from && to && from > to) throw new ConflictError("The report start date must be on or before its end date.");
}

export function isLabOrderOverdue(orderedAt: Date, turnaroundHours: number, now = new Date()) {
  return now.getTime() > orderedAt.getTime() + turnaroundHours * 3_600_000;
}

export const labAnalyticsService = {
  async overview(actor: AccessTokenPayload) {
    const today = hospitalDateKey();
    const todayRange = hospitalDateRange(today, today)!;
    const doctorId = await getActorDoctorId(actor);
    const doctorScope = doctorId ? { doctorId } : {};
    const [ordersToday, samplesPending, inProcess, criticalResults, expiringReagents, activeOrders, recentEvents] = await Promise.all([
      prisma.labOrder.count({ where: { ...doctorScope, orderedAt: todayRange } }),
      prisma.labOrder.count({ where: { ...doctorScope, status: "ORDERED", sampleCollectedAt: null } }),
      prisma.labOrder.count({ where: { ...doctorScope, status: { in: ["SAMPLE_COLLECTED", "PROCESSING"] } } }),
      prisma.labOrder.count({ where: { ...doctorScope, criticalResult: true, status: { not: "CANCELLED" } } }),
      prisma.labInventoryBatch.count({
        where: {
          quantity: { gt: 0 },
          expiryDate: { gte: new Date(`${today}T00:00:00+05:00`), lte: new Date(`${addHospitalDays(today, 30)}T23:59:59+05:00`) },
          item: { isActive: true, category: "REAGENT" },
        },
      }),
      prisma.labOrder.findMany({
        where: { ...doctorScope, status: { in: ["ORDERED", "SAMPLE_COLLECTED", "PROCESSING"] } },
        include: {
          patient: { select: { mrNumber: true, firstName: true, lastName: true } },
          test: { select: { testName: true, turnaroundTimeHours: true } },
          doctor: { include: { user: { select: { name: true } } } },
        },
        orderBy: [{ priority: "desc" }, { orderedAt: "asc" }],
      }),
      prisma.labOrderEvent.findMany({
        where: doctorId ? { labOrder: { doctorId } } : {},
        take: 12,
        orderBy: { createdAt: "desc" },
        include: {
          actor: { select: { name: true } },
          labOrder: {
            select: {
              orderNumber: true,
              test: { select: { testName: true } },
              patient: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);
    const now = new Date();
    const orders = activeOrders.map((order) => {
      const turnaroundHours = order.test.turnaroundTimeHours ?? 24;
      return {
        ...order,
        patientName: `${order.patient.firstName} ${order.patient.lastName}`.trim(),
        mrNumber: order.patient.mrNumber,
        doctorName: order.doctor?.user.name ?? "",
        testName: order.test.testName,
        overdue: isLabOrderOverdue(order.orderedAt, turnaroundHours, now),
        turnaroundHours,
      };
    });
    return {
      counts: { ordersToday, samplesPending, inProcess, criticalResults, expiringReagents },
      overdueCount: orders.filter((order) => order.overdue).length,
      orders: orders.slice(0, 50),
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        createdAt: event.createdAt,
        actorName: event.actor?.name ?? "System",
        orderNumber: event.labOrder.orderNumber,
        testName: event.labOrder.test.testName,
        patientName: `${event.labOrder.patient.firstName} ${event.labOrder.patient.lastName}`.trim(),
      })),
    };
  },

  async reports(from?: string, to?: string, includeRevenue = false) {
    ensureValidHospitalRange(from, to);
    const orderedAt = hospitalDateRange(from, to);
    const [orders, rejections, invoices] = await Promise.all([
      prisma.labOrder.findMany({
        where: { status: { not: "CANCELLED" }, ...(orderedAt ? { orderedAt } : {}) },
        select: {
          id: true,
          doctor: { select: { user: { select: { name: true } } } },
          test: { select: { category: true } },
          completedAt: true,
          orderedAt: true,
          results: {
            where: { supersededById: null },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              interpretation: true,
              createdAt: true,
              creator: { select: { name: true } },
              parameters: { select: { computedInterpretation: true, overriddenInterpretation: true } },
            },
          },
        },
      }),
      prisma.labSampleRejection.findMany({
        where: orderedAt ? { rejectedAt: orderedAt } : {},
        select: { reason: true, rejectedAt: true, labOrder: { select: { orderNumber: true, test: { select: { testName: true } }, patient: { select: { firstName: true, lastName: true } } } } },
      }),
      includeRevenue ? prisma.invoice.findMany({
        where: {
          status: { not: "VOID" },
          labOrders: { some: { status: { not: "CANCELLED" }, ...(orderedAt ? { orderedAt } : {}) } },
        },
        select: { id: true, grandTotal: true, paidAmount: true, balanceAmount: true },
      }) : Promise.resolve([]),
    ]);

    const byCategory = new Map<string, number>();
    const byDoctor = new Map<string, number>();
    const byTechnician = new Map<string, number>();
    let abnormalCount = 0;
    let criticalCount = 0;
    let turnaroundTotal = 0;
    let turnaroundCount = 0;
    for (const order of orders) {
      const category = order.test.category?.trim() || "Uncategorized";
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
      const doctor = order.doctor?.user.name ?? "Unassigned";
      byDoctor.set(doctor, (byDoctor.get(doctor) ?? 0) + 1);
      const result = order.results[0];
      if (result) {
        if (result.creator?.name) byTechnician.set(result.creator.name, (byTechnician.get(result.creator.name) ?? 0) + 1);
        const interpretations = result.parameters.flatMap((parameter) => [parameter.overriddenInterpretation ?? parameter.computedInterpretation].filter(Boolean));
        const abnormal = interpretations.some((value) => value !== "NORMAL") || result.interpretation === "HIGH" || result.interpretation === "LOW" || result.interpretation === "CRITICAL";
        const critical = interpretations.some((value) => value === "CRITICAL_LOW" || value === "CRITICAL_HIGH") || result.interpretation === "CRITICAL";
        if (abnormal) abnormalCount += 1;
        if (critical) criticalCount += 1;
      }
      if (order.completedAt) {
        turnaroundTotal += (order.completedAt.getTime() - order.orderedAt.getTime()) / 3_600_000;
        turnaroundCount += 1;
      }
    }
    return {
      from: from ?? null,
      to: to ?? null,
      revenue: includeRevenue ? {
        billed: invoices.reduce((sum, invoice) => sum + Number(invoice.grandTotal), 0),
        collected: invoices.reduce((sum, invoice) => sum + Number(invoice.paidAmount), 0),
        outstanding: invoices.reduce((sum, invoice) => sum + Number(invoice.balanceAmount), 0),
      } : null,
      orderCount: orders.length,
      testsByCategory: [...byCategory].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      doctorReferrals: [...byDoctor].map(([doctorName, count]) => ({ doctorName, count })).sort((a, b) => b.count - a.count),
      averageTurnaroundHours: turnaroundCount ? Math.round((turnaroundTotal / turnaroundCount) * 100) / 100 : 0,
      turnaroundSampleSize: turnaroundCount,
      abnormalCount,
      criticalCount,
      technicianCounts: [...byTechnician].map(([technicianName, count]) => ({ technicianName, count })).sort((a, b) => b.count - a.count),
      rejectedSampleCount: rejections.length,
      rejectedSamples: rejections.map((rejection) => ({
        reason: rejection.reason,
        rejectedAt: rejection.rejectedAt,
        orderNumber: rejection.labOrder.orderNumber,
        testName: rejection.labOrder.test.testName,
        patientName: `${rejection.labOrder.patient.firstName} ${rejection.labOrder.patient.lastName}`.trim(),
      })),
    };
  },
};
