import { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { ForbiddenError, NotFoundError, ConflictError, ValidationError } from "@common/errors/AppError";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { writeAuditLog } from "@common/utils/auditLog";
import { isCriticalVitals } from "@common/validation/vitals";

const HOSPITAL_TIME_ZONE = "Asia/Karachi";
type TodayAdmission = Prisma.AdmissionGetPayload<{
  include: {
    patient: { include: { prescriptions: { where: { status: { in: ["SIGNED", "COMPLETED"] }; deletedAt: null }; orderBy: { createdAt: "desc" }; include: { items: true } } } };
    attendingDoctor: { select: { id: true; userId: true; user: { select: { name: true } } } };
    bed: { include: { room: { include: { ward: true } } } };
    vitalsHistory: { orderBy: { recordedAt: "desc" }; take: 1 };
    wardRounds: { orderBy: { roundAt: "desc" }; take: 1 };
  };
}>;

export function hospitalDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function daysBetweenHospitalDates(earlier: Date, later: Date) {
  const start = Date.parse(`${hospitalDateKey(earlier)}T00:00:00Z`);
  const end = Date.parse(`${hospitalDateKey(later)}T00:00:00Z`);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function vitalValues(vital: {
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperature: Prisma.Decimal | null;
  respiratoryRate: number | null;
  oxygenSaturation: number | null;
}) {
  return {
    bp_systolic: vital.bpSystolic,
    bp_diastolic: vital.bpDiastolic,
    pulse: vital.pulse,
    temperature: vital.temperature === null ? null : Number(vital.temperature),
    temperature_unit: "F" as const,
    respiratory_rate: vital.respiratoryRate,
    oxygen_saturation: vital.oxygenSaturation,
  };
}

async function getAccessibleAdmission(actor: AccessTokenPayload, admissionId: string) {
  const admission = await prisma.admission.findUnique({
    where: { id: admissionId },
    include: {
      attendingDoctor: { select: { userId: true } },
      patient: { select: { id: true, age: true, allergies: true, firstName: true, lastName: true, mrNumber: true } },
      bed: { include: { room: { include: { ward: true } } } },
    },
  });
  if (!admission) throw new NotFoundError("Admission not found");
  if (actor.role !== "ADMIN" && (actor.role !== "DOCTOR" || admission.attendingDoctor.userId !== actor.sub)) {
    throw new ForbiddenError("Only the attending doctor or an administrator can access ward rounds for this admission");
  }
  return admission;
}

export const wardRoundsService = {
  async create(actor: AccessTokenPayload, admissionId: string, input: {
    subjective?: string;
    findings?: string;
    assessment?: string;
    plan?: string;
  }, req?: Request) {
    const admission = await getAccessibleAdmission(actor, admissionId);
    if (admission.status !== "ACTIVE") throw new ConflictError("Ward rounds can only be added for an active admission");
    if (![input.subjective, input.findings, input.assessment, input.plan].some((value) => value?.trim())) {
      throw new ValidationError("Enter at least one ward-round note.");
    }
    const current = await prisma.patientVitals.findFirst({
      where: { admissionId },
      orderBy: { recordedAt: "desc" },
    });
    const created = await prisma.wardRound.create({
      data: {
        admissionId,
        doctorId: actor.sub,
        subjective: input.subjective?.trim() || null,
        findings: input.findings?.trim() || null,
        assessment: input.assessment?.trim() || null,
        plan: input.plan?.trim() || null,
        vitalsSnapshot: current ? {
          recordedAt: current.recordedAt.toISOString(),
          ...vitalValues(current),
          isCritical: isCriticalVitals(vitalValues(current), admission.patient.age),
        } : Prisma.JsonNull,
      },
    });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "wards", entityType: "WardRound", entityId: created.id, newValues: created, req });
    return created;
  },

  async list(actor: AccessTokenPayload, admissionId: string) {
    await getAccessibleAdmission(actor, admissionId);
    return prisma.wardRound.findMany({
      where: { admissionId },
      include: { doctor: { select: { id: true, name: true } } },
      orderBy: [{ roundAt: "desc" }, { createdAt: "desc" }],
    });
  },

  async today(actor: AccessTokenPayload) {
    const now = new Date();
    const todayKey = hospitalDateKey(now);
    const doctor = actor.role === "DOCTOR"
      ? await prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } })
      : null;
    if (actor.role === "DOCTOR" && !doctor) throw new ForbiddenError("Doctor profile not found");
    const admissions = await prisma.admission.findMany({
      where: {
        status: "ACTIVE",
        ...(doctor ? { attendingDoctorId: doctor.id } : {}),
      },
      include: {
        patient: { include: { prescriptions: {
          where: { status: { in: ["SIGNED", "COMPLETED"] }, deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: { items: true },
        } } },
        attendingDoctor: { select: { id: true, userId: true, user: { select: { name: true } } } },
        bed: { include: { room: { include: { ward: true } } } },
        vitalsHistory: { orderBy: { recordedAt: "desc" }, take: 1 },
        wardRounds: { orderBy: { roundAt: "desc" }, take: 1 },
      },
      orderBy: { admissionDate: "asc" },
    });
    return Promise.all(admissions.map((admission) => this.mapTodayAdmission(admission, todayKey, now)));
  },

  async mapTodayAdmission(admission: TodayAdmission, todayKey: string, now: Date) {
    const [labOrders, ultrasoundOrders] = await Promise.all([
      prisma.labOrder.findMany({
        where: { patientId: admission.patientId, status: { notIn: ["VERIFIED", "CANCELLED"] } },
        include: { test: { select: { testName: true } }, results: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { orderedAt: "desc" },
      }),
      prisma.ultrasoundOrder.findMany({
        where: { patientId: admission.patientId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { id: true, examType: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const latestRound = admission.wardRounds[0] ?? null;
    const latestVital = admission.vitalsHistory[0] ?? null;
    const todayVitals = latestVital ? vitalValues(latestVital) : null;
    const signedRoundToday = latestRound !== null && hospitalDateKey(latestRound.roundAt) === todayKey;
    return {
      id: admission.id,
      admissionDate: admission.admissionDate,
      daysAdmitted: daysBetweenHospitalDates(admission.admissionDate, now),
      readyForDischarge: admission.readyForDischarge,
      patient: admission.patient,
      attendingDoctor: admission.attendingDoctor.user,
      bed: {
        id: admission.bed.id,
        bedNumber: admission.bed.bedNumber,
        room: admission.bed.room.roomNumber,
        ward: admission.bed.room.ward.wardName,
      },
      roundDoneToday: signedRoundToday,
      lastRoundAt: latestRound?.roundAt ?? null,
      latestVitals: latestVital ? {
        id: latestVital.id,
        recordedAt: latestVital.recordedAt,
        ...todayVitals,
        isCritical: isCriticalVitals(todayVitals!, admission.patient.age),
      } : null,
      pendingLabResults: labOrders.map((order) => ({
        id: order.id,
        test: order.test.testName,
        status: order.status,
        latestResult: order.results[0] ?? null,
        orderedAt: order.orderedAt,
      })),
      pendingUltrasoundResults: ultrasoundOrders,
      activeMedicationOrders: admission.patient.prescriptions.flatMap((prescription) => {
        return prescription.items.filter((item) => (
          prescription.createdAt.getTime() + item.durationDays * 86_400_000 >= now.getTime()
        )).map((item) => ({
          prescriptionId: prescription.id,
          name: item.medicineName,
          dose: item.dosage,
          frequency: item.frequency,
          durationDays: item.durationDays,
        }));
      }),
    };
  },

  async setReadyForDischarge(actor: AccessTokenPayload, admissionId: string, ready: boolean, req?: Request) {
    const admission = await getAccessibleAdmission(actor, admissionId);
    if (admission.status !== "ACTIVE") throw new ConflictError("Only active admissions can be marked ready for discharge");
    const updated = await prisma.admission.update({
      where: { id: admissionId },
      data: { readyForDischarge: ready, readyForDischargeAt: ready ? new Date() : null },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "wards",
      entityType: "Admission",
      entityId: admissionId,
      oldValues: { readyForDischarge: admission.readyForDischarge },
      newValues: { readyForDischarge: updated.readyForDischarge, readyForDischargeAt: updated.readyForDischargeAt },
      req,
    });
    return updated;
  },
};
