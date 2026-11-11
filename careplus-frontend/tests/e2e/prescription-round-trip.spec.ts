import { test, expect, type APIRequestContext } from "@playwright/test"
import { createDoctorAppointment } from "./fixtures"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }
const pharmacist = { email: "pharmacist@careplus.local", password: "Staff@12345" }

async function apiLogin(request: APIRequestContext, credentials = admin) {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

test("manual prescription is flagged for pharmacist review", async ({ page, request }) => {
  const session = await apiLogin(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const fixture = await createDoctorAppointment(request)

  const consultationResponse = await request.post(`${apiBase}/consultations`, { headers, data: { appointmentId: fixture.appointmentId, diagnosis: "Prescription round trip" } })
  expect(consultationResponse.ok()).toBeTruthy()
  const consultation = (await consultationResponse.json()).data
  const prescriptionResponse = await request.post(`${apiBase}/prescriptions`, { headers, data: { consultationId: consultation.id, items: [{ medicineName: "Round Trip Medicine", isCatalogItem: false, doseAmount: 1, doseUnit: "tablet", route: "Oral", frequencyCode: "OD", durationValue: 5, durationUnit: "days" }] } })
  expect(prescriptionResponse.ok()).toBeTruthy()
  const prescription = (await prescriptionResponse.json()).data
  const signPrescriptionResponse = await request.post(`${apiBase}/prescriptions/${prescription.id}/sign`, { headers })
  expect(signPrescriptionResponse.ok(), await signPrescriptionResponse.text()).toBeTruthy()
  const signConsultationResponse = await request.post(`${apiBase}/consultations/${consultation.id}/sign`, { headers })
  expect(signConsultationResponse.ok()).toBeTruthy()

  const pharmacistSession = await apiLoginAs(request, pharmacist)
  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, pharmacistSession)
  await page.goto("/dashboard/pharmacy")
  await expect(page.getByText("Prescriptions", { exact: true }).last()).toBeVisible()
  await page.getByRole("tab", { name: "Prescriptions" }).click()
  await page.getByPlaceholder(/Search patient, MR#, doctor/).fill(fixture.mrNumber)
  await expect(page.getByText("Round Trip Medicine", { exact: true }).first()).toBeVisible()
  const manualPrescriptionRow = page.getByRole("row").filter({ hasText: "Round Trip Medicine" }).first()
  await expect(manualPrescriptionRow).toContainText("SIGNED")
  await expect(manualPrescriptionRow).toContainText("Pharmacist review")
})

async function apiLoginAs(request: APIRequestContext, credentials: { email: string; password: string }) {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

test("allergy override requires confirmation and writes an audit record", async ({ page, request }) => {
  test.setTimeout(90_000)
  const fixture = await createDoctorAppointment(request)
  const doctorSession = await apiLoginAs(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
  const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
  const adminSession = await apiLoginAs(request, pharmacist)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const medicineName = `Amoxicillin E2E ${Date.now()}`
  const medicineResponse = await request.post(`${apiBase}/pharmacy/medicines`, {
    headers: adminHeaders,
    data: { name: medicineName, genericName: "Amoxicillin", strength: "500 mg", form: "Capsule", unitType: "CAPSULE" },
  })
  expect(medicineResponse.ok(), await medicineResponse.text()).toBeTruthy()
  const medicine = (await medicineResponse.json()).data as { id: string }
  const patientResponse = await request.get(`${apiBase}/patients?search=${encodeURIComponent(fixture.mrNumber)}`, { headers: doctorHeaders })
  expect(patientResponse.ok()).toBeTruthy()
  const patient = ((await patientResponse.json()).data as Array<{ id: string }>)[0]
  expect(patient).toBeTruthy()
  const summaryResponse = await request.get(`${apiBase}/patients/${patient.id}/clinical-summary`, { headers: doctorHeaders })
  expect(summaryResponse.ok()).toBeTruthy()
  const initialSummary = (await summaryResponse.json()).data as { allergies: string[]; chronicConditions: string[] }
  const setupResponse = await request.patch(`${apiBase}/patients/${patient.id}/clinical-summary`, {
    headers: doctorHeaders,
    data: { allergies: ["Penicillin"], allergiesReviewed: true, chronicConditions: initialSummary.chronicConditions, chronicConditionsReviewed: true },
  })
  expect(setupResponse.ok(), await setupResponse.text()).toBeTruthy()

  try {
  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, doctorSession)
  await page.goto(`/dashboard/doctor/consultation/${fixture.appointmentId}?mr=${encodeURIComponent(fixture.mrNumber)}`)
  await expect(page.getByText("Penicillin", { exact: true })).toBeVisible()

  await page.getByLabel("Systolic (mmHg)").fill("120")
  await page.getByLabel("Diastolic (mmHg)").fill("80")
  await page.getByLabel("Pulse (bpm)").fill("72")
  await page.getByLabel("Temperature", { exact: true }).fill("98.6")
  await page.getByLabel("Respiratory rate (/min)").fill("16")
  await page.getByLabel("SpO2 (%)").fill("98")
  await page.getByLabel("Chief Complaint").fill("Allergy override review")
  await page.getByLabel("Diagnosis").fill("Allergy override review")
  await page.getByRole("button", { name: "Add Medicine" }).click()
  const medicineInput = page.getByLabel("Medicine 1")
  await medicineInput.fill(medicineName)
  const allergyConfirmation = page.waitForEvent("dialog")
  const selectMedicine = page.getByRole("button", { name: new RegExp(medicineName) }).click()
  const allergyConfirmDialog = await allergyConfirmation
  expect(allergyConfirmDialog.message()).toContain("Penicillin")
  await allergyConfirmDialog.accept()
  await selectMedicine
  await page.getByLabel("Dose").fill("1")
  await page.getByLabel("Duration").fill("5")
  await page.getByRole("button", { name: "Sign Prescription" }).click()
  await expect(page.getByText("Prescription signed", { exact: true })).toBeVisible()

  const consultationsResponse = await request.get(`${apiBase}/consultations?appointmentId=${fixture.appointmentId}`, { headers: doctorHeaders })
  expect(consultationsResponse.ok()).toBeTruthy()
  const consultationId = ((await consultationsResponse.json()).data as Array<{ id: string }>)[0].id
  const prescriptionsResponse = await request.get(`${apiBase}/prescriptions?limit=100`, { headers: doctorHeaders })
  expect(prescriptionsResponse.ok()).toBeTruthy()
  const prescription = ((await prescriptionsResponse.json()).data as Array<{ id: string; consultationId: string }>).find((item) => item.consultationId === consultationId)
  expect(prescription).toBeTruthy()

  const auditResponse = await request.get(`${apiBase}/audit-logs?entityType=PrescriptionAllergyOverride&entityId=${prescription!.id}`, {
    headers: { Authorization: `Bearer ${fixture.adminAccessToken}` },
  })
  expect(auditResponse.ok()).toBeTruthy()
  expect((await auditResponse.json()).data).toHaveLength(1)
  } finally {
    const restoreResponse = await request.patch(`${apiBase}/patients/${patient.id}/clinical-summary`, {
      headers: doctorHeaders,
      data: {
        allergies: initialSummary.allergies,
        allergiesReviewed: true,
        chronicConditions: initialSummary.chronicConditions,
        chronicConditionsReviewed: true,
      },
    })
    expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy()
    const archiveResponse = await request.delete(`${apiBase}/pharmacy/medicines/${medicine.id}`, { headers: adminHeaders })
    expect(archiveResponse.ok(), await archiveResponse.text()).toBeTruthy()
  }
})