import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { generateMrNumber } from "@common/utils/sequenceGenerators";
import { PageParams } from "@common/utils/pagination";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { assertPatientAccess, getActorDoctorId } from "@common/utils/recordAuthorization";

interface CreatePatientInput {
  firstName: string;
  lastName: string;
  age: number;
  gender: string;
  phone: string;
  email?: string;
  address?: string;
  cnic?: string;
  bloodGroup?: string;
  allergies?: string[];
  allergiesReviewed?: boolean;
  chronicConditions?: string[];
  chronicConditionsReviewed?: boolean;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
  force?: boolean;
}

export function canExposePatientBalance(role: string): boolean {
  return role !== "LAB_TECHNICIAN";
}

export const patientsService = {
  async list(actor: AccessTokenPayload, params: PageParams & { search?: string }) {
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      NOT: [{ firstName: { contains: "Lifecycle", mode: "insensitive" } }, { lastName: { contains: "Lifecycle", mode: "insensitive" } }],
      ...(params.search
        ? {
            OR: [
              { firstName: { contains: params.search, mode: "insensitive" } },
              { lastName: { contains: params.search, mode: "insensitive" } },
              { phone: { contains: params.search } },
              { mrNumber: { contains: params.search, mode: "insensitive" } },
              { cnic: { contains: params.search } },
            ],
          }
        : {}),
    };
    if (actor.role === "DOCTOR") {
      const access = await prisma.patient.findMany({
        where: { ...where, OR: [{ appointments: { some: { doctor: { userId: actor.sub } } } }, { consultations: { some: { doctor: { userId: actor.sub } } } }, { labOrders: { some: { doctor: { userId: actor.sub } } } }, { admissions: { some: { attendingDoctor: { userId: actor.sub } } } }, { surgeries: { some: { surgeon: { userId: actor.sub } } } }] },
        select: { id: true },
      });
      where.id = { in: access.map((patient) => patient.id) };
    }

    const [items, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.patient.count({ where }),
    ]);

    const includeBalances = canExposePatientBalance(actor.role);
    const [invoices, ledgerEntries] = !includeBalances || items.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.invoice.findMany({
            where: { patientId: { in: items.map((patient) => patient.id) }, status: { not: "VOID" } },
            select: { patientId: true, balanceAmount: true },
          }),
          prisma.patientLedgerEntry.findMany({
            where: { patientId: { in: items.map((patient) => patient.id) } },
            select: { patientId: true, amount: true },
          }),
        ]);
    const balancesByPatient = new Map<string, number>();
    for (const invoice of invoices) {
      if (!invoice.patientId) continue;
      balancesByPatient.set(invoice.patientId, (balancesByPatient.get(invoice.patientId) ?? 0) + Number(invoice.balanceAmount));
    }
    for (const entry of ledgerEntries) {
      if (!entry.patientId) continue;
      balancesByPatient.set(entry.patientId, (balancesByPatient.get(entry.patientId) ?? 0) - Number(entry.amount));
    }

    const lastVisitRows = items.length > 0
      ? await prisma.$queryRaw<Array<{ patientId: string; lastVisit: string | null }>>`
          SELECT p.id AS "patientId",
            GREATEST(
              MAX(a.appointment_date),
              MAX(((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')::date)
            )::text AS "lastVisit"
          FROM patients p
          LEFT JOIN appointments a ON a.patient_id = p.id AND a.status = 'COMPLETED'
          LEFT JOIN consultations c ON c.patient_id = p.id AND c.prescription_status IN ('SIGNED', 'COMPLETED')
          WHERE p.id IN (${Prisma.join(items.map((patient) => patient.id))})
          GROUP BY p.id
        `
      : [];
    const lastVisitByPatient = new Map(lastVisitRows.map((row) => [row.patientId, row.lastVisit]));

    return {
      items: items.map((patient) => {
        const lastVisit = lastVisitByPatient.get(patient.id) ?? null;
        return {
          ...patient,
          age: Math.max(0, patient.age ?? 0),
          lastVisit,
          ...(includeBalances ? { balance: balancesByPatient.get(patient.id) ?? 0 } : {}),
        };
      }),
      total,
    };
  },

  async getById(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const patient = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!patient) throw new NotFoundError("Patient not found");
    return patient;
  },

  async getClinicalSummary(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const patient = await prisma.patient.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        allergies: true,
        allergiesReviewed: true,
        chronicConditions: true,
        chronicConditionsReviewed: true,
        notes: true,
        consultations: {
          orderBy: [{ appointment: { appointmentDate: "desc" } }, { createdAt: "desc" }],
          take: 50,
          select: {
            id: true,
            diagnosis: true,
            completedAt: true,
            createdAt: true,
            bpSystolic: true,
            bpDiastolic: true,
            pulse: true,
            temperature: true,
            temperatureUnit: true,
            respiratoryRate: true,
            weight: true,
            oxygenSaturation: true,
            heightCm: true,
            isCritical: true,
            vitalsEstimated: true,
            appointment: { select: { id: true, appointmentDate: true } },
            doctor: { select: { user: { select: { name: true } } } },
          },
        },
        prescriptions: {
          where: { deletedAt: null },
          orderBy: [{ signedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          include: {
            doctor: { select: { user: { select: { name: true } } } },
            items: {
              select: {
                id: true, medicineId: true, medicineName: true, dosage: true,
                doseAmount: true, doseUnit: true, frequency: true, frequencyCode: true,
                durationDays: true, durationValue: true, durationUnit: true, route: true,
              },
            },
          },
        },
        labOrders: {
          orderBy: { orderedAt: "desc" },
          take: 50,
          include: {
            test: { select: { testName: true } },
            results: {
              where: { supersededById: null },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        ultrasoundOrders: {
          orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          take: 50,
          select: { id: true, examType: true, status: true, createdAt: true, completedAt: true, impression: true, findings: true },
        },
        ultrasoundReports: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, examinationType: true, status: true, createdAt: true, completedAt: true, conclusion: true },
        },
        admissions: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { admissionDate: "desc" },
          select: {
            id: true, admissionDate: true,
            bed: { select: { bedNumber: true, bedLabel: true, room: { select: { roomNumber: true, ward: { select: { wardName: true } } } } } },
          },
        },
        invoices: { where: { status: { not: "VOID" } }, select: { balanceAmount: true } },
        ledgerEntries: { select: { amount: true } },
      },
    });
    if (!patient) throw new NotFoundError("Patient not found");

    const visits = patient.consultations.slice(0, 3).map((visit) => ({
      date: visit.completedAt ?? visit.appointment.appointmentDate,
      doctor: visit.doctor.user.name,
      diagnosis: visit.diagnosis,
      appointmentId: visit.appointment.id,
    }));
    const currentPrescription = patient.prescriptions[0] ?? null;
    const mapMedicine = (prescription: typeof currentPrescription) =>
      prescription?.items.map((item) => ({
        medicineId: item.medicineId,
        name: item.medicineName,
        dose: [item.doseAmount, item.doseUnit].filter((part) => part !== null).join(" ") || item.dosage,
        frequency: item.frequencyCode ?? item.frequency,
        duration: item.durationValue ? `${item.durationValue} ${item.durationUnit ?? "days"}` : `${item.durationDays} days`,
        doseAmount: item.doseAmount ?? (Number(item.dosage.match(/^[\d.]+/)?.[0]) || null),
        doseUnit: item.doseUnit ?? (item.dosage.replace(/^[\d.]+\s*/, "") || "tablet"),
        route: item.route,
        frequencyCode: item.frequencyCode ?? "OD",
        durationValue: item.durationValue ?? item.durationDays,
        durationUnit: item.durationUnit ?? "days",
        date: prescription.signedAt ?? prescription.createdAt,
        signed: prescription.status === "SIGNED" || prescription.status === "COMPLETED",
      })) ?? [];
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const previouslyPrescribed = new Map<string, ReturnType<typeof mapMedicine>[number]>();
    for (const prescription of patient.prescriptions) {
      const prescribedAt = prescription.signedAt ?? prescription.createdAt;
      if (prescribedAt < ninetyDaysAgo) continue;
      for (const medicine of mapMedicine(prescription)) {
        const key = medicine.medicineId ?? medicine.name.trim().toLocaleLowerCase();
        if (!previouslyPrescribed.has(key)) previouslyPrescribed.set(key, medicine);
      }
    }
    const vitalRows = await prisma.consultation.findMany({
      where: {
        patientId: id,
        OR: [
          { bpSystolic: { not: null } }, { bpDiastolic: { not: null } }, { pulse: { not: null } },
          { temperature: { not: null } }, { respiratoryRate: { not: null } }, { weight: { not: null } },
          { oxygenSaturation: { not: null } }, { heightCm: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        completedAt: true, createdAt: true, bpSystolic: true, bpDiastolic: true, pulse: true,
        temperature: true, temperatureUnit: true, respiratoryRate: true, weight: true,
        oxygenSaturation: true, heightCm: true, vitalsEstimated: true, isCritical: true,
      },
    });
    const consultationVitals = vitalRows
      .filter((visit) => visit.bpSystolic !== null || visit.bpDiastolic !== null || visit.pulse !== null || visit.temperature !== null || visit.respiratoryRate !== null || visit.weight !== null || visit.oxygenSaturation !== null || visit.heightCm !== null)
      .map((visit) => ({
        date: visit.completedAt ?? visit.createdAt,
        systolic: visit.bpSystolic,
        diastolic: visit.bpDiastolic,
        pulse: visit.pulse,
        temperature: visit.temperature,
        temperatureUnit: visit.temperatureUnit,
        respiratoryRate: visit.respiratoryRate,
        weight: visit.weight,
        oxygenSaturation: visit.oxygenSaturation,
        heightCm: visit.heightCm,
        estimated: visit.vitalsEstimated,
        isCritical: visit.isCritical,
      }));
    const ultrasoundRecords = [
      ...patient.ultrasoundOrders.map((item) => ({ id: item.id, type: item.examType, status: item.status, date: item.completedAt ?? item.createdAt, result: item.impression ?? item.findings })),
      ...patient.ultrasoundReports.map((item) => ({ id: item.id, type: item.examinationType, status: item.status, date: item.completedAt ?? item.createdAt, result: item.conclusion })),
    ].sort((left, right) => right.date.getTime() - left.date.getTime()).slice(0, 3);
    const labResults = patient.labOrders.map((order) => {
      const result = order.results[0];
      return {
        test: order.test.testName,
        status: order.status,
        result: result ? [result.resultValue, result.unit].filter(Boolean).join(" ") : null,
        flag: result?.interpretation ?? null,
        date: result?.createdAt ?? order.orderedAt,
      };
    });
    const outstandingBalance = Math.max(
      0,
      patient.invoices.reduce((total, invoice) => total + Number(invoice.balanceAmount), 0) -
        patient.ledgerEntries.reduce((total, entry) => total + Number(entry.amount), 0),
    );
    const [criticalVitalsRecord, abnormalLabResult] = await Promise.all([
      prisma.consultation.findFirst({
        where: { patientId: id, isCritical: true },
        select: { id: true },
      }),
      prisma.labResult.findFirst({
        where: {
          interpretation: { in: ["HIGH", "LOW", "CRITICAL"] },
          supersededById: null,
          labOrder: { patientId: id },
        },
        select: { id: true },
      }),
    ]);
    return {
      allergies: patient.allergies,
      allergiesReviewed: patient.allergiesReviewed,
      chronicConditions: patient.chronicConditions,
      chronicConditionsReviewed: patient.chronicConditionsReviewed,
      medicalHistory: patient.notes,
      visits,
      lastPrescription: currentPrescription ? {
        date: currentPrescription.signedAt ?? currentPrescription.createdAt,
        signed: currentPrescription.status === "SIGNED" || currentPrescription.status === "COMPLETED",
        medicines: mapMedicine(currentPrescription),
      } : null,
      prescriptions: patient.prescriptions,
      previouslyPrescribedMedicines: [...previouslyPrescribed.values()],
      vitals: consultationVitals.slice(0, 5),
      labResults,
      ultrasounds: ultrasoundRecords,
      currentAdmission: patient.admissions[0] ? {
        ward: patient.admissions[0].bed.room.ward.wardName,
        bed: patient.admissions[0].bed.bedLabel ?? patient.admissions[0].bed.bedNumber,
        since: patient.admissions[0].admissionDate,
      } : null,
      outstandingBalance,
      hasCriticalVitals: criticalVitalsRecord !== null,
      hasAbnormalLab: abnormalLabResult !== null,
    };
  },

  async updateClinicalHistory(actor: AccessTokenPayload, id: string, input: {
    allergies: string[];
    allergiesReviewed: true;
    chronicConditions: string[];
    chronicConditionsReviewed: true;
  }, req?: import("express").Request) {
    await assertPatientAccess(actor, id);
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("Patient not found");
    const updated = await prisma.patient.update({
      where: { id },
      data: {
        allergies: input.allergies,
        allergiesReviewed: true,
        chronicConditions: input.chronicConditions,
        chronicConditionsReviewed: true,
      },
    });
    await writeAuditLog({
      userId: actor.sub,
      action: "UPDATE",
      module: "patients",
      entityType: "PatientClinicalHistory",
      entityId: id,
      oldValues: { allergies: existing.allergies, chronicConditions: existing.chronicConditions },
      newValues: { allergies: updated.allergies, chronicConditions: updated.chronicConditions },
      req,
    });
    return {
      allergies: updated.allergies,
      allergiesReviewed: updated.allergiesReviewed,
      chronicConditions: updated.chronicConditions,
      chronicConditionsReviewed: updated.chronicConditionsReviewed,
    };
  },

  async getProfile(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const startOfToday = new Date(`${today}T00:00:00.000Z`);
    const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
    const doctorId = actor.role === "DOCTOR" ? await getActorDoctorId(actor) : null;
    const patient = await prisma.patient.findFirst({
      where: { id, deletedAt: null },
      include: {
        appointments: {
          where: {
            appointmentDate: { gte: startOfToday, lt: startOfTomorrow },
            status: { in: ["CONFIRMED", "WAITING", "IN_CONSULTATION"] },
            ...(doctorId ? { doctorId } : {}),
          },
          orderBy: [{ appointmentDate: "asc" }, { timeSlot: "asc" }],
          include: {
            doctor: { include: { user: { select: { name: true } }, department: { select: { name: true } } } },
          },
        },
        consultations: {
          orderBy: { createdAt: "desc" },
          include: {
            appointment: { select: { appointmentDate: true, tokenNumber: true, status: true } },
            doctor: { include: { user: { select: { name: true } }, department: { select: { name: true } } } },
            prescriptions: { where: { deletedAt: null }, include: { items: true } },
            labOrders: { include: { test: { select: { testName: true } } } },
            ultrasoundOrders: { select: { examType: true } },
          },
        },
        prescriptions: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            items: true,
            doctor: { include: { user: { select: { name: true } }, department: { select: { name: true } } } },
            consultation: { select: { followUpDate: true, followUpInstructions: true, appointment: { select: { appointmentDate: true, tokenNumber: true } } } },
          },
        },
        labOrders: {
          orderBy: { orderedAt: "desc" },
          include: {
            test: true,
            doctor: { include: { user: { select: { name: true } } } },
            results: { orderBy: { createdAt: "desc" } },
          },
        },
        ultrasoundOrders: {
          orderBy: { createdAt: "desc" },
          include: {
            doctor: { include: { user: { select: { name: true } } } },
            technician: { select: { name: true } },
          },
        },
        invoices: {
          where: { status: { not: "VOID" } },
          orderBy: { createdAt: "desc" },
          include: { items: true, payments: { where: { deletedAt: null }, orderBy: { paymentDate: "desc" } }, pharmacySale: { include: { items: { include: { medicine: { select: { name: true } } } } } } },
        },
        admissions: {
          orderBy: { admissionDate: "desc" },
          include: {
            bed: { include: { room: { include: { ward: { select: { wardName: true } } } } } },
            attendingDoctor: { include: { user: { select: { name: true } } } },
            ledgerEntries: { orderBy: { createdAt: "desc" } },
            vitalsHistory: { orderBy: { recordedAt: "desc" }, take: 1 },
          },
        },
        ledgerEntries: { orderBy: { createdAt: "desc" } },
        surgeries: {
          orderBy: { scheduledStart: "desc" },
          include: {
            patient: { select: { mrNumber: true, firstName: true, lastName: true } },
            surgeon: { include: { user: { select: { name: true } } } },
            otRoom: true,
          },
        },
      },
    });
    if (!patient) throw new NotFoundError("Patient not found");
    const activeAdmission = patient.admissions.find((admission) => admission.status === "ACTIVE") ?? null;
    const vitals = [
      ...patient.consultations
        .filter((consultation) => consultation.bpSystolic !== null || consultation.bpDiastolic !== null || consultation.pulse !== null || consultation.temperature !== null || consultation.oxygenSaturation !== null)
        .map((consultation) => ({
          recordedAt: consultation.completedAt ?? consultation.appointment.appointmentDate,
          systolic: consultation.bpSystolic,
          diastolic: consultation.bpDiastolic,
          pulse: consultation.pulse,
          temperature: consultation.temperature,
          temperatureUnit: consultation.temperatureUnit,
          respiratoryRate: consultation.respiratoryRate,
          weight: consultation.weight,
          oxygenSaturation: consultation.oxygenSaturation,
          heightCm: consultation.heightCm,
          estimated: consultation.vitalsEstimated,
        })),
      ...patient.admissions.flatMap((admission) => admission.vitalsHistory.map((vital) => ({
        recordedAt: vital.recordedAt,
        systolic: vital.bpSystolic,
        diastolic: vital.bpDiastolic,
        pulse: vital.pulse,
        temperature: vital.temperature === null ? null : Number(vital.temperature),
        temperatureUnit: "C",
        respiratoryRate: vital.respiratoryRate,
        weight: null,
        oxygenSaturation: vital.oxygenSaturation,
        heightCm: null,
        estimated: false,
      }))),
    ].sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime());
    const {
      appointments,
      consultations,
      prescriptions,
      labOrders,
      ultrasoundOrders,
      invoices,
      admissions,
      ledgerEntries,
      surgeries,
      ...patientData
    } = patient;
    return {
      patient: patientData,
      consultations,
      prescriptions,
      labOrders,
      ultrasoundOrders,
      invoices,
      admissions,
      surgeries,
      activeAdmission,
      ledgerEntries,
      startableAppointments: appointments,
      lastVitals: vitals[0] ?? null,
    };
  },

  async getPrintSummary(actor: AccessTokenPayload, id: string) {
    await assertPatientAccess(actor, id);
    const patient = await prisma.patient.findFirst({
      where: { id, deletedAt: null },
      include: {
        consultations: {
          where: { prescriptionStatus: { in: ["SIGNED", "COMPLETED"] } },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { appointment: { select: { appointmentDate: true } }, doctor: { select: { specialization: true } } },
        },
        prescriptions: {
          where: { deletedAt: null, status: { in: ["SIGNED", "COMPLETED"] } },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { items: true },
        },
        labOrders: {
          orderBy: { orderedAt: "desc" },
          take: 10,
          include: { test: { select: { testName: true } }, results: { orderBy: { createdAt: "desc" } } },
        },
        ultrasoundReports: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 10 },
        ultrasoundOrders: { where: { status: { in: ["REPORTED", "DELIVERED"] } }, orderBy: { completedAt: "desc" }, take: 10 },
        admissions: {
          orderBy: { admissionDate: "desc" },
          take: 20,
          include: {
            bed: { include: { room: { include: { ward: { select: { wardName: true } } } } } },
            vitalsHistory: { orderBy: { recordedAt: "desc" }, take: 1 },
          },
        },
        invoices: { where: { status: { not: "VOID" } }, select: { balanceAmount: true } },
        ledgerEntries: { select: { amount: true } },
        surgeries: {
          where: { status: { in: ["COMPLETED", "RECOVERY", "IN_PROGRESS"] } },
          orderBy: { scheduledStart: "desc" },
          take: 10,
          select: { id: true, surgeryType: true, scheduledStart: true, status: true },
        },
      },
    });
    if (!patient) throw new NotFoundError("Patient not found");
    const balance = patient.invoices.reduce((total, invoice) => total + Number(invoice.balanceAmount), 0) -
      patient.ledgerEntries.reduce((total, entry) => total + Number(entry.amount), 0);
    const consultations = patient.consultations.map(({ appointment, doctor, ...consultation }) => ({
      ...consultation,
      visitDate: appointment.appointmentDate,
      doctorSpecialty: doctor.specialization,
    }));
    const lastConsultation = patient.consultations[0];
    const admissionVitals = patient.admissions.flatMap((admission) => admission.vitalsHistory ?? []);
    const latestAdmissionVital = admissionVitals.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0];
    const consultationVitals = lastConsultation
      ? {
          recordedAt: lastConsultation.completedAt ?? lastConsultation.createdAt,
          systolic: lastConsultation.bpSystolic,
          diastolic: lastConsultation.bpDiastolic,
          pulse: lastConsultation.pulse,
          temperature: lastConsultation.temperature,
          temperatureUnit: lastConsultation.temperatureUnit,
          respiratoryRate: lastConsultation.respiratoryRate,
          weight: lastConsultation.weight,
          oxygenSaturation: lastConsultation.oxygenSaturation,
          heightCm: lastConsultation.heightCm,
          estimated: lastConsultation.vitalsEstimated,
          critical: lastConsultation.isCritical,
        }
      : null;
    const nursingVitals = latestAdmissionVital
      ? {
            recordedAt: latestAdmissionVital.recordedAt,
            systolic: latestAdmissionVital.bpSystolic,
            diastolic: latestAdmissionVital.bpDiastolic,
            pulse: latestAdmissionVital.pulse,
            temperature: latestAdmissionVital.temperature === null ? null : Number(latestAdmissionVital.temperature),
            temperatureUnit: "C",
            respiratoryRate: latestAdmissionVital.respiratoryRate,
            weight: null,
            oxygenSaturation: latestAdmissionVital.oxygenSaturation,
            heightCm: null,
            estimated: false,
            critical: false,
          }
      : null;
    const lastVitals = [consultationVitals, nursingVitals]
      .filter((vital): vital is NonNullable<typeof vital> => vital !== null)
      .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime())[0] ?? null;
    const {
      invoices: _invoices,
      ledgerEntries: _ledgerEntries,
      consultations: _consultations,
      prescriptions: _prescriptions,
      labOrders: _labOrders,
      ultrasoundReports: _ultrasoundReports,
      ultrasoundOrders: _ultrasoundOrders,
      admissions: _admissions,
      surgeries: _surgeries,
      ...demographics
    } = patient;
    return {
      patient: demographics,
      chronicConditions: patient.chronicConditions,
      medicines: patient.prescriptions.flatMap((prescription) =>
        prescription.items.map((item) => ({
          ...item,
          prescribedAt: prescription.signedAt ?? prescription.createdAt,
        })),
      ),
      recentVisits: consultations,
      labResults: patient.labOrders.flatMap((order) =>
        order.results.map((result) => ({ ...result, testName: order.test.testName, orderedAt: order.orderedAt })),
      ),
      ultrasoundResults: [
        ...patient.ultrasoundReports.map((report) => ({ id: report.id, examinationType: report.examinationType, conclusion: report.conclusion, completedAt: report.completedAt })),
        ...patient.ultrasoundOrders.map((order) => ({ id: order.id, examinationType: order.examType, conclusion: order.impression || order.findings, completedAt: order.completedAt })),
      ].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)),
      lastVitals,
      admissions: patient.admissions,
      surgeries: patient.surgeries,
      balance,
    };
  },

  async create(actorId: string, input: CreatePatientInput, req?: import("express").Request) {
    const phone = input.phone.replace(/\D/g, "");
    const formattedPhone = phone.length === 11 && phone.startsWith("03")
      ? `${phone.slice(0, 4)}-${phone.slice(4)}`
      : phone;
    const address = input.address?.trim();
    // Duplicate detection by phone OR CNIC
    if (!input.force) {
      const cnicRaw = input.cnic ? input.cnic.replace(/\D/g, "") : null;
      const cnicFormatted = cnicRaw && cnicRaw.length === 13
        ? `${cnicRaw.slice(0, 5)}-${cnicRaw.slice(5, 12)}-${cnicRaw.slice(12)}`
        : input.cnic;

      const duplicateConditions: Prisma.PatientWhereInput[] = [];
      const phoneCandidates = [...new Set([phone, formattedPhone])].filter(Boolean);
      if (phoneCandidates.length > 0) {
        duplicateConditions.push({ phone: { in: phoneCandidates } });
      }
      if (cnicRaw || input.cnic) {
        const cnicCandidates = [...new Set([input.cnic, cnicRaw, cnicFormatted].filter(Boolean))] as string[];
        duplicateConditions.push({ cnic: { in: cnicCandidates } });
      }

      if (duplicateConditions.length > 0) {
        const duplicate = await prisma.patient.findFirst({
          where: {
            deletedAt: null,
            OR: duplicateConditions,
          },
        });
        if (duplicate) {
          const isCnicMatch = Boolean((cnicRaw || input.cnic) && duplicate.cnic && (
            duplicate.cnic === input.cnic || duplicate.cnic.replace(/\D/g, "") === cnicRaw
          ));
          const reason = isCnicMatch
            ? `A patient with CNIC ${input.cnic} is already registered under MR: ${duplicate.mrNumber} (${duplicate.firstName} ${duplicate.lastName}).`
            : `A patient with phone ${input.phone} already exists (MR: ${duplicate.mrNumber}). Pass force=true to create anyway.`;
          throw new ConflictError(
            reason,
            { existingPatientId: duplicate.id, existingMrNumber: duplicate.mrNumber }
          );
        }
      }
    }

    const normalizedCnic = input.cnic ? input.cnic.replace(/\D/g, "") : null;

    let patient;
    try {
      patient = await prisma.$transaction(async (tx) => {
        const mrNumber = await generateMrNumber(tx);
        return tx.patient.create({
          data: {
            mrNumber,
            firstName: input.firstName,
            lastName: input.lastName,
            age: input.age,
            gender: input.gender as never,
            phone,
            email: input.email,
            address: address && address.toLowerCase() !== "none" ? address : undefined,
            cnic: input.cnic,
            normalizedCnic: normalizedCnic || null,
            bloodGroup: input.bloodGroup as never,
            allergies: input.allergies ?? [],
            emergencyContactName: input.emergencyContactName,
            emergencyContactPhone: input.emergencyContactPhone,
            notes: input.notes,
            createdBy: actorId,
          },
        });
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta as { target?: string[] | string })?.target;
        const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
        if (targetStr.includes("normalized_cnic") || targetStr.includes("cnic")) {
          const existing = normalizedCnic ? await prisma.patient.findFirst({ where: { normalizedCnic, deletedAt: null } }) : null;
          throw new ConflictError(
            `A patient with CNIC ${input.cnic} is already registered${existing ? ` under MR: ${existing.mrNumber} (${existing.firstName} ${existing.lastName})` : ""}.`,
            existing ? { existingPatientId: existing.id, existingMrNumber: existing.mrNumber } : undefined
          );
        }
      }
      throw err;
    }

    await writeAuditLog({ userId: actorId, action: "CREATE", module: "patients", entityType: "Patient", entityId: patient.id, newValues: patient, req });
    return patient;
  },

  async update(actorId: string, id: string, input: Partial<CreatePatientInput>, req?: import("express").Request) {
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("Patient not found");

    const data: Prisma.PatientUpdateInput = { ...input } as never;
    if (input.cnic !== undefined) {
      data.normalizedCnic = input.cnic ? input.cnic.replace(/\D/g, "") : null;
    }
    if (typeof input.phone === "string") data.phone = input.phone.replace(/\D/g, "");
    if (typeof input.address === "string") {
      const address = input.address.trim();
      data.address = address && address.toLowerCase() !== "none" ? address : null;
    }
    if (typeof input.age === "number") {
      data.age = input.age;
    }
    let updated;
    try {
      updated = await prisma.patient.update({ where: { id }, data });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta as { target?: string[] | string })?.target;
        const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
        if (targetStr.includes("normalized_cnic") || targetStr.includes("cnic")) {
          throw new ConflictError(`A patient with this CNIC is already registered.`);
        }
      }
      throw err;
    }

    await writeAuditLog({
      userId: actorId,
      action: "UPDATE",
      module: "patients",
      entityType: "Patient",
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req,
    });
    return updated;
  },

  async softDelete(actorId: string, id: string, req?: import("express").Request) {
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("Patient not found");

    const updated = await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAuditLog({ userId: actorId, action: "DELETE", module: "patients", entityType: "Patient", entityId: id, oldValues: existing, req });
    return updated;
  },

  async restore(actorId: string, id: string, req?: import("express").Request) {
    const existing = await prisma.patient.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!existing) throw new NotFoundError("Deleted patient not found");

    const updated = await prisma.patient.update({ where: { id }, data: { deletedAt: null } });

    await writeAuditLog({ userId: actorId, action: "RESTORE", module: "patients", entityType: "Patient", entityId: id, newValues: updated, req });
    return updated;
  },

  /** Admin-only merge of duplicate patient records ΓÇö reassigns all related records, audit-logged. */
  async merge(actorId: string, primaryPatientId: string, duplicatePatientId: string, req?: import("express").Request) {
    if (primaryPatientId === duplicatePatientId) {
      throw new BadRequestError("Cannot merge a patient into itself");
    }

    const [primary, duplicate] = await Promise.all([
      prisma.patient.findFirst({ where: { id: primaryPatientId, deletedAt: null } }),
      prisma.patient.findFirst({ where: { id: duplicatePatientId, deletedAt: null } }),
    ]);
    if (!primary) throw new NotFoundError("Primary patient not found");
    if (!duplicate) throw new NotFoundError("Duplicate patient not found");

    await prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.consultation.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.prescription.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.labOrder.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.invoice.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.admission.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });
      await tx.surgery.updateMany({ where: { patientId: duplicatePatientId }, data: { patientId: primaryPatientId } });

      await tx.patient.update({
        where: { id: duplicatePatientId },
        data: { deletedAt: new Date(), mergedIntoPatientId: primaryPatientId },
      });

      await writeAuditLog(
        {
          userId: actorId,
          action: "UPDATE",
          module: "patients",
          entityType: "Patient",
          entityId: primaryPatientId,
          oldValues: { duplicatePatientId },
          newValues: { mergedFrom: duplicatePatientId },
          req,
        },
        tx
      );
    });

    return { primaryPatientId, mergedPatientId: duplicatePatientId };
  },
};
