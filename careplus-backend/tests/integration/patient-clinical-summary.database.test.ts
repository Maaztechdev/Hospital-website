import { randomUUID } from "crypto";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { signAccessToken } from "../../src/modules/auth/token.utils";
import { patientsService } from "../../src/modules/patients/patients.service";

describe("Patient clinical summary", () => {
  afterAll(() => {
    redis.disconnect();
  });

  it("returns persisted history and enforces existing doctor-to-patient access", async () => {
    const suffix = randomUUID();
    const userIds: string[] = [];
    const doctorIds: string[] = [];
    const patientIds: string[] = [];
    const appointmentIds: string[] = [];
    const consultationIds: string[] = [];
    const prescriptionIds: string[] = [];
    const labOrderIds: string[] = [];
    const ultrasoundOrderIds: string[] = [];
    let testId: string | undefined;

    try {
      const admin = await prisma.user.create({
        data: { name: "Clinical Summary Admin", email: `clinical-admin-${suffix}@careplus.test`, passwordHash: "test-hash", role: "ADMIN" },
      });
      userIds.push(admin.id);
      const doctorUser = await prisma.user.create({
        data: { name: "Clinical Summary Doctor", email: `clinical-doctor-${suffix}@careplus.test`, passwordHash: "test-hash", role: "DOCTOR" },
      });
      userIds.push(doctorUser.id);
      const otherDoctorUser = await prisma.user.create({
        data: { name: "Other Clinical Doctor", email: `clinical-other-${suffix}@careplus.test`, passwordHash: "test-hash", role: "DOCTOR" },
      });
      userIds.push(otherDoctorUser.id);
      const doctor = await prisma.doctor.create({ data: { userId: doctorUser.id, consultationFee: 100 } });
      doctorIds.push(doctor.id);
      const otherDoctor = await prisma.doctor.create({ data: { userId: otherDoctorUser.id, consultationFee: 100 } });
      doctorIds.push(otherDoctor.id);
      const patient = await prisma.patient.create({
        data: {
          mrNumber: `MR-CLINICAL-${suffix}`,
          firstName: "Clinical",
          lastName: "Summary",
          age: 42,
          gender: "OTHER",
          phone: `03${suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`,
          allergies: ["Penicillin"],
          allergiesReviewed: true,
          chronicConditions: ["Hypertension"],
          chronicConditionsReviewed: true,
          notes: "History of hypertension",
          createdBy: admin.id,
        },
      });
      patientIds.push(patient.id);
      const unrelatedPatient = await prisma.patient.create({
        data: {
          mrNumber: `MR-CLINICAL-OTHER-${suffix}`,
          firstName: "Unrelated",
          lastName: "Patient",
          age: 30,
          gender: "OTHER",
          phone: `04${suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "0")}`,
          createdBy: admin.id,
        },
      });
      patientIds.push(unrelatedPatient.id);
      const test = await prisma.labTest.create({
        data: { testName: `Clinical CBC ${suffix}`, testCode: `CLIN${suffix.replace(/-/g, "").slice(0, 20)}`, price: 100 },
      });
      testId = test.id;
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);

      for (let index = 0; index < 3; index += 1) {
        const appointment = await prisma.appointment.create({
          data: {
            patientId: patient.id,
            doctorId: doctor.id,
            appointmentDate: day,
            timeSlot: new Date(`1970-01-01T${String(9 + index).padStart(2, "0")}:00:00.000Z`),
            tokenNumber: index + 1,
            appointmentType: "CONSULTATION",
            status: "COMPLETED",
            source: "WALK_IN",
            createdBy: admin.id,
          },
        });
        appointmentIds.push(appointment.id);
        const consultation = await prisma.consultation.create({
          data: {
            appointmentId: appointment.id,
            patientId: patient.id,
            doctorId: doctor.id,
            diagnosis: `Diagnosis ${index + 1}`,
            pulse: 70 + index,
            weight: 60 + index,
            isCritical: index === 2,
            completedAt: new Date(Date.now() - (2 - index) * 60_000),
          },
        });
        consultationIds.push(consultation.id);
        if (index < 2) {
          const prescription = await prisma.prescription.create({
            data: {
              consultationId: consultation.id,
              patientId: patient.id,
              doctorId: doctor.id,
              status: "SIGNED",
              signedAt: new Date(Date.now() - (1 - index) * 60_000),
              items: {
                create: {
                  medicineName: index ? "Medicine Two" : "Medicine One",
                  dosage: "1 tablet",
                  doseAmount: 1,
                  doseUnit: "tablet",
                  route: "Oral",
                  frequency: "once daily",
                  frequencyCode: "OD",
                  durationDays: 3,
                  durationValue: 3,
                  durationUnit: "days",
                },
              },
            },
          });
          prescriptionIds.push(prescription.id);
        }
      }
      const labOrder = await prisma.labOrder.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          testId: test.id,
          status: "VERIFIED",
          createdBy: admin.id,
          results: { create: { resultValue: "8.2", unit: "g/dL", interpretation: "LOW" } },
        },
      });
      labOrderIds.push(labOrder.id);
      const ultrasound = await prisma.ultrasoundOrder.create({
        data: { patientId: patient.id, doctorId: doctor.id, examType: "KUB", status: "COMPLETED", completedAt: new Date() },
      });
      ultrasoundOrderIds.push(ultrasound.id);
      const unrelatedAppointment = await prisma.appointment.create({
        data: {
          patientId: unrelatedPatient.id,
          doctorId: otherDoctor.id,
          appointmentDate: day,
          timeSlot: new Date("1970-01-01T13:00:00.000Z"),
          tokenNumber: 1,
          appointmentType: "CONSULTATION",
          status: "COMPLETED",
          source: "WALK_IN",
          createdBy: admin.id,
        },
      });
      appointmentIds.push(unrelatedAppointment.id);
      const unrelatedConsultation = await prisma.consultation.create({
        data: { appointmentId: unrelatedAppointment.id, patientId: unrelatedPatient.id, doctorId: otherDoctor.id },
      });
      consultationIds.push(unrelatedConsultation.id);

      const actor = { sub: doctorUser.id, role: "DOCTOR" as const, email: doctorUser.email };
      const summary = await patientsService.getClinicalSummary(actor, patient.id);
      expect(summary.allergies).toEqual(["Penicillin"]);
      expect(summary.allergiesReviewed).toBe(true);
      expect(summary.chronicConditions).toEqual(["Hypertension"]);
      expect(summary.visits).toHaveLength(3);
      expect(summary.visits[0].diagnosis).toBe("Diagnosis 3");
      expect(summary.lastPrescription?.medicines[0]).toMatchObject({ name: "Medicine Two", doseAmount: 1, frequencyCode: "OD", durationValue: 3, signed: true });
      expect(summary.previouslyPrescribedMedicines).toHaveLength(2);
      expect(summary.vitals[0]).toMatchObject({ pulse: 72, weight: 62, isCritical: true });
      expect(summary.labResults[0]).toMatchObject({ test: `Clinical CBC ${suffix}`, result: "8.2 g/dL", flag: "LOW" });
      expect(summary.ultrasounds[0]).toMatchObject({ type: "KUB", status: "COMPLETED" });
      expect(summary.hasCriticalVitals).toBe(true);
      expect(summary.hasAbnormalLab).toBe(true);
      await expect(patientsService.getClinicalSummary(actor, unrelatedPatient.id)).rejects.toThrow("not authorized");
      const token = signAccessToken(actor);
      const app = createApp();
      const response = await request(app)
        .get(`/api/v1/patients/${patient.id}/clinical-summary`)
        .set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        allergies: ["Penicillin"],
        chronicConditions: ["Hypertension"],
        visits: expect.arrayContaining([expect.objectContaining({ diagnosis: "Diagnosis 3" })]),
        hasAbnormalLab: true,
      });
      const deniedResponse = await request(app)
        .get(`/api/v1/patients/${unrelatedPatient.id}/clinical-summary`)
        .set("Authorization", `Bearer ${token}`);
      expect(deniedResponse.status).toBe(403);
      const updatedResponse = await request(app)
        .patch(`/api/v1/patients/${patient.id}/clinical-summary`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          allergies: ["Penicillin", "Latex"],
          allergiesReviewed: true,
          chronicConditions: ["Hypertension", "Asthma"],
          chronicConditionsReviewed: true,
        });
      expect(updatedResponse.status).toBe(200);
      expect(updatedResponse.body.data.allergies).toEqual(["Penicillin", "Latex"]);
    } finally {
      await prisma.ultrasoundOrder.deleteMany({ where: { id: { in: ultrasoundOrderIds } } });
      if (labOrderIds.length) await prisma.labResult.deleteMany({ where: { labOrderId: { in: labOrderIds } } });
      await prisma.labOrder.deleteMany({ where: { id: { in: labOrderIds } } });
      await prisma.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
      await prisma.consultation.deleteMany({ where: { id: { in: consultationIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
      await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
      if (testId) await prisma.labTest.deleteMany({ where: { id: testId } });
      await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
      await prisma.authAttempt.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
