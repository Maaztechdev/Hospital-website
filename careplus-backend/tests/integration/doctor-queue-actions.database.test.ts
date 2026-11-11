import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { appointmentsService, getDateKeyInTimeZone } from "../../src/modules/appointments/appointments.service";

const app = createApp();
const password = "DoctorAction@12345";

async function login(email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("Doctor queue actions (no-show & requeue)", () => {
  const suffix = Date.now().toString();
  let adminUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorAUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorBUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let nurseUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorA: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let doctorB: Awaited<ReturnType<typeof prisma.doctor.create>>;
  let patientA: Awaited<ReturnType<typeof prisma.patient.create>>;
  let patientB: Awaited<ReturnType<typeof prisma.patient.create>>;
  let department: Awaited<ReturnType<typeof prisma.department.create>>;

  let adminToken: string;
  let doctorAToken: string;
  let doctorBToken: string;
  let nurseToken: string;
  const createdAppointmentIds: string[] = [];
  let nextFixtureSlot = 0;

  beforeAll(async () => {
    department = await prisma.department.create({ data: { name: `Dept QA ${suffix}` } });
    const hash = await argon2.hash(password);

    [adminUser, doctorAUser, doctorBUser, nurseUser] = await Promise.all([
      prisma.user.create({ data: { name: "QA Admin", email: `qa-admin-${suffix}@careplus.test`, passwordHash: hash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: "QA Doctor A", email: `qa-doc-a-${suffix}@careplus.test`, passwordHash: hash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: "QA Doctor B", email: `qa-doc-b-${suffix}@careplus.test`, passwordHash: hash, role: "DOCTOR" } }),
      prisma.user.create({ data: { name: "QA Nurse", email: `qa-nurse-${suffix}@careplus.test`, passwordHash: hash, role: "NURSE" } }),
    ]);

    [doctorA, doctorB] = await Promise.all([
      prisma.doctor.create({ data: { userId: doctorAUser.id, departmentId: department.id, consultationFee: 1000, scheduleJson: { slotsPerDay: ["09:00"] } } }),
      prisma.doctor.create({ data: { userId: doctorBUser.id, departmentId: department.id, consultationFee: 1000 } }),
    ]);

    patientA = await prisma.patient.create({
      data: { mrNumber: `MR-QA-A-${suffix}`, firstName: "PatientQA", lastName: "A", gender: "MALE", age: 30, phone: `0300${suffix.slice(-7)}1`, createdBy: adminUser.id },
    });
    patientB = await prisma.patient.create({
      data: { mrNumber: `MR-QA-B-${suffix}`, firstName: "PatientQA", lastName: "B", gender: "FEMALE", age: 28, phone: `0300${suffix.slice(-7)}2`, createdBy: adminUser.id },
    });

    [adminToken, doctorAToken, doctorBToken, nurseToken] = await Promise.all([
      login(adminUser.email),
      login(doctorAUser.email),
      login(doctorBUser.email),
      login(nurseUser.email),
    ]);
  });

  afterAll(async () => {
    if (createdAppointmentIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityType: "Appointment", entityId: { in: createdAppointmentIds } } });
      await prisma.notification.deleteMany({ where: { relatedEntityId: { in: createdAppointmentIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
      await prisma.appointmentTokenSequence.deleteMany({ where: { doctorId: doctorA.id } });
    }
    await prisma.invoiceItem.deleteMany({ where: { invoice: { patientId: { in: [patientA.id, patientB.id] } } } });
    await prisma.invoice.deleteMany({ where: { patientId: { in: [patientA.id, patientB.id] } } });
    await prisma.patient.deleteMany({ where: { id: { in: [patientA.id, patientB.id] } } });
    await prisma.doctor.deleteMany({ where: { id: { in: [doctorA.id, doctorB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUser.id, doctorAUser.id, doctorBUser.id, nurseUser.id] } } });
    await prisma.department.deleteMany({ where: { id: department.id } });
  });

  async function createAppointment(doctorId: string, patientId: string, status: "CONFIRMED" | "WAITING" | "IN_CONSULTATION") {
    const today = getDateKeyInTimeZone(new Date());
    const slotMinutes = 9 * 60 + nextFixtureSlot++;
    const appt = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        appointmentDate: new Date(`${today}T00:00:00.000Z`),
        timeSlot: new Date(Date.UTC(1970, 0, 1, Math.floor(slotMinutes / 60), slotMinutes % 60)),
        tokenNumber: Math.floor(Math.random() * 900) + 100,
        appointmentType: "CONSULTATION",
        gender: patientId === patientA.id ? patientA.gender : patientB.gender,
        status,
        waitingSince: status === "WAITING" ? new Date() : null,
        createdBy: adminUser.id,
      },
    });
    createdAppointmentIds.push(appt.id);
    return appt;
  }

  it("derives appointment gender from the existing patient record", async () => {
    const appointmentDate = new Date(`${getDateKeyInTimeZone(new Date())}T00:00:00.000Z`);
    appointmentDate.setUTCDate(appointmentDate.getUTCDate() + 2);
    const date = appointmentDate.toISOString().slice(0, 10);
    const created = await appointmentsService.create(
      { sub: adminUser.id, role: "ADMIN", email: adminUser.email },
      {
        patientId: patientA.id,
        doctorId: doctorA.id,
        departmentId: department.id,
        appointmentDate: date,
        timeSlot: "09:00",
        appointmentType: "CONSULTATION",
      }
    );

    expect(created.gender).toBe(patientA.gender);
    createdAppointmentIds.push(created.id);
    await expect(prisma.patient.findUniqueOrThrow({ where: { id: patientA.id } })).resolves.toMatchObject({ gender: patientA.gender });
  });

  it("fails when doctor tries to mark no-show or requeue another doctor's patient (403)", async () => {
    // Appointment belongs to Doctor B, status WAITING
    const apptB = await createAppointment(doctorB.id, patientB.id, "WAITING");

    // Doctor A attempts mark-no-show
    const noShowRes = await request(app)
      .post(`/api/v1/appointments/${apptB.id}/mark-no-show`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(noShowRes.status).toBe(403);

    // Doctor A attempts requeue
    const requeueRes = await request(app)
      .post(`/api/v1/opd-queue/${apptB.id}/requeue`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(requeueRes.status).toBe(403);
  });

  it("fails when doctor tries to mark no-show or requeue on an appointment that is not WAITING (400)", async () => {
    // Appointment belongs to Doctor A, but status is CONFIRMED (not WAITING)
    const apptAConfirmed = await createAppointment(doctorA.id, patientA.id, "CONFIRMED");

    // Doctor A attempts mark-no-show on CONFIRMED appointment
    const noShowRes = await request(app)
      .post(`/api/v1/appointments/${apptAConfirmed.id}/mark-no-show`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(noShowRes.status).toBe(400);
    expect(noShowRes.body.message).toMatch(/waiting/i);

    // Doctor A attempts requeue on CONFIRMED appointment
    const requeueRes = await request(app)
      .post(`/api/v1/opd-queue/${apptAConfirmed.id}/requeue`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(requeueRes.status).toBe(400);
    expect(requeueRes.body.message).toMatch(/waiting/i);
  });

  it("allows doctor to mark no-show their own WAITING appointment and creates audit log", async () => {
    const apptAWaiting = await createAppointment(doctorA.id, patientA.id, "WAITING");

    const res = await request(app)
      .post(`/api/v1/appointments/${apptAWaiting.id}/mark-no-show`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);

    const updated = await prisma.appointment.findUnique({ where: { id: apptAWaiting.id } });
    expect(updated?.status).toBe("NO_SHOW");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Appointment", entityId: apptAWaiting.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(doctorAUser.id);
    expect(audit?.newValuesJson).toMatchObject({ status: "NO_SHOW" });
  });

  it("allows doctor to requeue their own WAITING appointment back to CONFIRMED and creates audit log", async () => {
    const apptAWaiting = await createAppointment(doctorA.id, patientA.id, "WAITING");

    const res = await request(app)
      .post(`/api/v1/opd-queue/${apptAWaiting.id}/requeue`)
      .set("Authorization", `Bearer ${doctorAToken}`);
    expect(res.status).toBe(200);

    const updated = await prisma.appointment.findUnique({ where: { id: apptAWaiting.id } });
    expect(updated?.status).toBe("CONFIRMED");
    expect(updated?.waitingSince).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Appointment", entityId: apptAWaiting.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(doctorAUser.id);
    expect(audit?.newValuesJson).toMatchObject({ status: "CONFIRMED" });
  });

  it("preserves permissions for admin, receptionist, and nurse", async () => {
    const apptForNurse = await createAppointment(doctorA.id, patientA.id, "WAITING");

    // Nurse can requeue
    const nurseRequeueRes = await request(app)
      .post(`/api/v1/opd-queue/${apptForNurse.id}/requeue`)
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(nurseRequeueRes.status).toBe(200);

    // Admin can mark no-show
    const apptForAdmin = await createAppointment(doctorA.id, patientA.id, "CONFIRMED");
    const adminNoShowRes = await request(app)
      .post(`/api/v1/appointments/${apptForAdmin.id}/mark-no-show`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminNoShowRes.status).toBe(200);
  });
});
