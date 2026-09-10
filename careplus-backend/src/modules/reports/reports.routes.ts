import { Request, Response, Router } from "express";
import { z } from "zod";
import { prisma } from "@config/prisma";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";

const dateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const dateSchema = z.object({ date: z.string().date().optional() });

function rangeFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  };
}

const reportsService = {
  async revenueSummary(from?: string, to?: string) {
    const createdAt = rangeFilter(from, to);
    const invoices = await prisma.invoice.findMany({
      where: { status: { not: "VOID" }, ...(createdAt ? { createdAt } : {}) },
      select: { grandTotal: true, paidAmount: true, balanceAmount: true, status: true },
    });
    const totalBilled = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);
    const totalCollected = invoices.reduce((s, i) => s + Number(i.paidAmount), 0);
    const totalOutstanding = invoices.reduce((s, i) => s + Number(i.balanceAmount), 0);
    return { invoiceCount: invoices.length, totalBilled, totalCollected, totalOutstanding };
  },

  async appointmentStats(from?: string, to?: string) {
    const appointmentDate = rangeFilter(from, to);
    const grouped = await prisma.appointment.groupBy({
      by: ["status"],
      where: appointmentDate ? { appointmentDate } : {},
      _count: { _all: true },
    });
    return grouped.map((g) => ({ status: g.status, count: g._count._all }));
  },

  async bedOccupancy() {
    const total = await prisma.bed.count({ where: { isActive: true } });
    const occupied = await prisma.bed.count({ where: { isActive: true, status: "OCCUPIED" } });
    return { totalBeds: total, occupiedBeds: occupied, occupancyRate: total > 0 ? Math.round((occupied / total) * 10000) / 100 : 0 };
  },

  async surgeryStats(date?: string) {
    const scheduledStart = date
      ? { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) }
      : undefined;
    const grouped = await prisma.surgery.groupBy({
      by: ["status"],
      where: scheduledStart ? { scheduledStart } : {},
      _count: { _all: true },
    });
    return grouped.map((item) => ({ status: item.status, count: item._count._all }));
  },

  async lowStockMedicines() {
    const batches = await prisma.medicineBatch.findMany({
      where: { isActive: true },
      include: { medicine: true },
    });
    return batches.filter((b) => b.stockQuantity <= b.reorderLevel).map((b) => ({
      medicineName: b.medicine.name,
      batchNumber: b.batchNumber,
      stockQuantity: b.stockQuantity,
      reorderLevel: b.reorderLevel,
    }));
  },

  async nearExpiryMedicines(days = 60) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);
    const batches = await prisma.medicineBatch.findMany({
      where: { isActive: true, expiryDate: { lte: threshold }, stockQuantity: { gt: 0 } },
      include: { medicine: true },
      orderBy: { expiryDate: "asc" },
    });
    return batches.map((b) => ({ medicineName: b.medicine.name, batchNumber: b.batchNumber, expiryDate: b.expiryDate, stockQuantity: b.stockQuantity }));
  },

  async labTurnaroundStats(from?: string, to?: string) {
    const orderedAt = rangeFilter(from, to);
    const orders = await prisma.labOrder.findMany({
      where: { status: { in: ["COMPLETED", "VERIFIED"] }, ...(orderedAt ? { orderedAt } : {}), completedAt: { not: null } },
      select: { orderedAt: true, completedAt: true },
    });
    if (orders.length === 0) return { averageTurnaroundHours: 0, sampleSize: 0 };
    const totalHours = orders.reduce((s, o) => s + (o.completedAt!.getTime() - o.orderedAt.getTime()) / 3600000, 0);
    return { averageTurnaroundHours: Math.round((totalHours / orders.length) * 100) / 100, sampleSize: orders.length };
  },

  async doctorProductivity(from?: string, to?: string) {
    const createdAt = rangeFilter(from, to);
    const grouped = await prisma.consultation.groupBy({
      by: ["doctorId"],
      where: createdAt ? { createdAt } : {},
      _count: { _all: true },
    });
    const doctors = await prisma.doctor.findMany({ where: { id: { in: grouped.map((g) => g.doctorId) } }, include: { user: { select: { name: true } } } });
    return grouped.map((g) => ({
      doctorId: g.doctorId,
      doctorName: doctors.find((d) => d.id === g.doctorId)?.user.name ?? "Unknown",
      consultationCount: g._count._all,
    }));
  },
};

const router = Router();
router.use(authenticate, requireRole(["ADMIN"]));

router.get("/revenue-summary", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  sendSuccess(res, 200, { data: await reportsService.revenueSummary(from, to) });
}));

router.get("/appointment-stats", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  sendSuccess(res, 200, { data: await reportsService.appointmentStats(from, to) });
}));

router.get("/bed-occupancy", asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, { data: await reportsService.bedOccupancy() });
}));

router.get("/surgery-stats", validate({ query: dateSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query as { date?: string };
  sendSuccess(res, 200, { data: await reportsService.surgeryStats(date) });
}));

router.get("/low-stock-medicines", asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, { data: await reportsService.lowStockMedicines() });
}));

router.get("/near-expiry-medicines", asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, { data: await reportsService.nearExpiryMedicines() });
}));

router.get("/lab-turnaround", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  sendSuccess(res, 200, { data: await reportsService.labTurnaroundStats(from, to) });
}));

router.get("/doctor-productivity", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  sendSuccess(res, 200, { data: await reportsService.doctorProductivity(from, to) });
}));

export default router;
