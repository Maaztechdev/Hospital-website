import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { createPrintE2EFixture, deletePrintE2EFixture, disconnectPrintE2EFixture } from "../helpers/print-e2e-fixture";

const app = createApp();

describe("Print document data and structured discharge summaries", () => {
  let fixture: Awaited<ReturnType<typeof createPrintE2EFixture>>;
  let headers: { Authorization: string };

  beforeAll(async () => {
    fixture = await createPrintE2EFixture();
    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@careplus.local", password: "Admin@12345" });
    expect(login.status).toBe(200);
    headers = { Authorization: `Bearer ${login.body.data.accessToken as string}` };
  });

  afterAll(async () => {
    if (fixture) await deletePrintE2EFixture(fixture);
    await disconnectPrintE2EFixture();
    redis.disconnect();
  });

  it("serves patient, discharge, and prescription print data and validates/saves discharge fields", async () => {
    const patientPrint = await request(app).get(`/api/v1/patients/${fixture.patientId}/print-summary`).set(headers);
    expect(patientPrint.status).toBe(200);
    expect(patientPrint.body.data).toMatchObject({
      patient: { id: fixture.patientId, mrNumber: expect.any(String) },
      chronicConditions: [],
      balance: 100,
    });

    const prescriptionPrint = await request(app).get(`/api/v1/prescriptions/consultations/${fixture.consultationId}/print`).set(headers);
    expect(prescriptionPrint.status).toBe(200);
    expect(prescriptionPrint.body.data.prescription.items[0].medicineName).toBe(fixture.medicineName);

    const dischargeUrl = `/api/v1/wards/admissions/${fixture.admissionId}/discharge`;
    const requiredFieldFailure = await request(app).post(dischargeUrl).set(headers).send({
      courseInHospital: "Observed.",
      medications: [],
      referral: "",
      confirmUnpaidBalance: false,
    });
    expect(requiredFieldFailure.status).toBe(422);
    expect(requiredFieldFailure.body.errors).toMatchObject({
      diagnosis: expect.any(Array),
      conditionAtDischarge: expect.any(Array),
      instructions: expect.any(Array),
    });

    const unconfirmedBalance = await request(app).post(dischargeUrl).set(headers).send({
      diagnosis: "Print E2E diagnosis",
      courseInHospital: "Observed and treated during admission.",
      medications: ["Take medicine as directed."],
      conditionAtDischarge: "Stable.",
      referral: "",
      instructions: "Return if symptoms worsen.",
      confirmUnpaidBalance: false,
    });
    expect(unconfirmedBalance.status).toBe(409);
    expect(unconfirmedBalance.body.message).toContain("Confirm discharge with the balance pending");

    const discharge = await request(app).post(dischargeUrl).set(headers).send({
      diagnosis: "Print E2E diagnosis",
      courseInHospital: "Observed and treated during admission.",
      medications: ["Take medicine as directed."],
      conditionAtDischarge: "Stable.",
      followUpDate: "2026-10-21",
      referral: "Cardiology clinic",
      instructions: "Return if symptoms worsen.",
      confirmUnpaidBalance: true,
    });
    expect(discharge.status).toBe(200);
    const saved = await prisma.admission.findUniqueOrThrow({ where: { id: fixture.admissionId } });
    expect(saved.dischargeDetails).toMatchObject({
      diagnosis: "Print E2E diagnosis",
      courseInHospital: "Observed and treated during admission.",
      procedures: [],
      medications: ["Take medicine as directed."],
      conditionAtDischarge: "Stable.",
      followUpDate: "2026-10-21",
      referral: "Cardiology clinic",
      instructions: "Return if symptoms worsen.",
    });

    const dischargePrint = await request(app).get(`/api/v1/wards/admissions/${fixture.admissionId}/print`).set(headers);
    expect(dischargePrint.status).toBe(200);
    expect(dischargePrint.body.data).toMatchObject({
      admission: { id: fixture.admissionId, dischargeDetails: { diagnosis: "Print E2E diagnosis" } },
      outstandingBalance: 100,
    });
  });
});
