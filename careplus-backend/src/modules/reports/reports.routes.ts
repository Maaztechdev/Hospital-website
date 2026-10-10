import { Request, Response, Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { authenticate } from "@common/middleware/authenticate";
import { requireRole } from "@common/middleware/requireRole";
import { validate } from "@common/middleware/validate";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess } from "@common/utils/apiResponse";

const dateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  departmentId: z.string().uuid().optional(),
});

const dateSchema = z.object({ date: z.string().date().optional(), departmentId: z.string().uuid().optional() });
const bedOccupancySchema = z.object({ wardType: z.enum(["GENERAL", "PRIVATE", "ICU"]).optional() });

function addCalendarDays(dateKey: string, daysToAdd: number) {
  let [year, month, day] = dateKey.split("-").map(Number);
  const isLeapYear = (value: number) => value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0);
  const daysInMonth = (value: number, monthIndex: number) => monthIndex === 2 ? (isLeapYear(value) ? 29 : 28) : [4, 6, 9, 11].includes(monthIndex) ? 30 : 31;
  while (daysToAdd > 0) {
    const remaining = daysInMonth(year, month) - day;
    if (daysToAdd <= remaining) { day += daysToAdd; daysToAdd = 0 }
    else { daysToAdd -= remaining + 1; day = 1; month += 1; if (month > 12) { month = 1; year += 1 } }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currentHospitalDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rangeFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00+05:00`) } : {}),
    ...(to ? { lt: new Date(`${addCalendarDays(to, 1)}T00:00:00+05:00`) } : {}),
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
  async revenueTrend(from: string, to: string) {
    const payments = await prisma.payment.findMany({
      where: { deletedAt: null, paymentDate: rangeFilter(from, to) },
      select: { paymentDate: true, amount: true },
      orderBy: { paymentDate: "asc" },
    });
    const totals = new Map<string, number>();
    for (const payment of payments) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(payment.paymentDate);
      totals.set(day, (totals.get(day) ?? 0) + Number(payment.amount));
    }
    const points: Array<{ label: string; value: number }> = [];
    const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekdayIndex = (dateKey: string) => {
      const [yearValue, month, day] = dateKey.split("-").map(Number);
      const year = yearValue - (month < 3 ? 1 : 0);
      const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
      return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + offsets[month - 1] + day) % 7;
    };
    for (let key = from; key <= to; key = addCalendarDays(key, 1)) {
      points.push({ label: weekdayNames[weekdayIndex(key)], value: totals.get(key) ?? 0 });
    }
    return points;
  },

  async appointmentStats(from?: string, to?: string, departmentId?: string) {
    const conditions: Prisma.Sql[] = [];
    if (from) conditions.push(Prisma.sql`appointment_date >= ${from}::date`);
    if (to) conditions.push(Prisma.sql`appointment_date <= ${to}::date`);
    if (departmentId) conditions.push(Prisma.sql`department_id = ${departmentId}`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
    return prisma.$queryRaw<Array<{ status: string; count: number }>>(Prisma.sql`
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM appointments
      ${where}
      GROUP BY status
    `);
  },

  async departmentDistribution(departmentId?: string) {
    const appointments = await prisma.appointment.findMany({
      where: departmentId ? { departmentId } : {},
      select: { doctor: { select: { department: { select: { name: true } } } } },
    });
    const totals = new Map<string, number>();
    for (const appointment of appointments) {
      const department = appointment.doctor.department?.name ?? "Unassigned";
      totals.set(department, (totals.get(department) ?? 0) + 1);
    }
    return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  },

  async bedOccupancy(wardType?: "GENERAL" | "PRIVATE" | "ICU") {
    const where = { isActive: true, ...(wardType ? { room: { ward: { wardType } } } : {}) };
    const total = await prisma.bed.count({ where });
    const occupied = await prisma.bed.count({ where: { ...where, status: "OCCUPIED" } });
    return { totalBeds: total, occupiedBeds: occupied, occupancyRate: total > 0 ? Math.round((occupied / total) * 10000) / 100 : 0 };
  },

  async surgeryStats(date?: string, departmentId?: string) {
    const scheduledStart = date
      ? { gte: new Date(`${date}T00:00:00+05:00`), lt: new Date(`${addCalendarDays(date, 1)}T00:00:00+05:00`) }
      : undefined;
    const grouped = await prisma.surgery.groupBy({
      by: ["status"],
      where: { ...(scheduledStart ? { scheduledStart } : {}), ...(departmentId ? { surgeon: { departmentId } } : {}) },
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

  async doctorProductivity(from?: string, to?: string, departmentId?: string) {
    const createdAt = rangeFilter(from, to);
    const grouped = await prisma.consultation.groupBy({
      by: ["doctorId"],
      where: { ...(createdAt ? { createdAt } : {}), ...(departmentId ? { doctor: { departmentId } } : {}) },
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
router.get("/revenue-trend", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const requestedFrom = typeof req.query.from === "string" ? req.query.from : undefined;
  const requestedTo = typeof req.query.to === "string" ? req.query.to : undefined;
  const end = requestedTo ?? currentHospitalDateKey();
  const start = requestedFrom ?? addCalendarDays(end, -6);
  sendSuccess(res, 200, { data: await reportsService.revenueTrend(start, end) });
}));

router.get("/appointment-stats", validate({ query: dateRangeSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  sendSuccess(res, 200, { data: await reportsService.appointmentStats(from, to, req.query.departmentId as string | undefined) });
}));

router.get("/department-distribution", validate({ query: z.object({ departmentId: z.string().uuid().optional() }) }), asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, { data: await reportsService.departmentDistribution(req.query.departmentId as string | undefined) });
}));

router.get("/bed-occupancy", validate({ query: bedOccupancySchema }), asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, { data: await reportsService.bedOccupancy(req.query.wardType as "GENERAL" | "PRIVATE" | "ICU" | undefined) });
}));

router.get("/surgery-stats", validate({ query: dateSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { date } = req.query as { date?: string };
  sendSuccess(res, 200, { data: await reportsService.surgeryStats(date, req.query.departmentId as string | undefined) });
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
  sendSuccess(res, 200, { data: await reportsService.doctorProductivity(from, to, req.query.departmentId as string | undefined) });
}));

export default router;
