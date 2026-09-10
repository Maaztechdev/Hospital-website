import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }
const pharmacist = { email: "pharmacist@careplus.local", password: "Staff@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

test("completed consultation creates a signed prescription visible to pharmacy", async ({ page, request }) => {
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const appointmentsResponse = await request.get(`${apiBase}/appointments?limit=100`, { headers })
  expect(appointmentsResponse.ok()).toBeTruthy()
  const appointments = (await appointmentsResponse.json()).data
  const consultationsResponse = await request.get(`${apiBase}/consultations?limit=100`, { headers })
  expect(consultationsResponse.ok()).toBeTruthy()
  const consultationIds = new Set((await consultationsResponse.json()).data.map((item: { appointmentId: string }) => item.appointmentId))
  const appointment = appointments.find((item: { id: string; status: string }) => !consultationIds.has(item.id) && item.status !== "CANCELLED" && item.status !== "DONE")
  expect(appointment).toBeTruthy()

  const consultationResponse = await request.post(`${apiBase}/consultations`, { headers, data: { appointmentId: appointment.id, diagnosis: "Prescription round trip" } })
  expect(consultationResponse.ok()).toBeTruthy()
  const consultation = (await consultationResponse.json()).data
  const prescriptionResponse = await request.post(`${apiBase}/prescriptions`, { headers, data: { consultationId: consultation.id, items: [{ medicineName: "Round Trip Medicine", dosage: "1 tablet", route: "Oral", frequency: "Once daily", durationDays: 5 }] } })
  expect(prescriptionResponse.ok()).toBeTruthy()
  const prescription = (await prescriptionResponse.json()).data
  const signPrescriptionResponse = await request.post(`${apiBase}/prescriptions/${prescription.id}/sign`, { headers })
  expect(signPrescriptionResponse.ok()).toBeTruthy()
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
  await page.getByText("Prescriptions", { exact: true }).last().click()
  await expect(page.getByText("Round Trip Medicine", { exact: true })).toBeVisible()
  await expect(page.getByText("Signed", { exact: true })).toBeVisible()
})

async function apiLoginAs(request: APIRequestContext, credentials: { email: string; password: string }) {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}