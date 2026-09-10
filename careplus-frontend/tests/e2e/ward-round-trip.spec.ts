import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

async function expectBedState(page: import("@playwright/test").Page, bedNumber: string, status: string) {
  const tile = page.getByRole("button").filter({ hasText: bedNumber }).first()
  await expect(tile).toContainText(status)
}

test("ward admission transfer and discharge persist after reload", async ({ page, request }) => {
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const [patientsResponse, doctorsResponse, bedsResponse, admissionsResponse] = await Promise.all([
    request.get(`${apiBase}/patients?limit=100`, { headers }),
    request.get(`${apiBase}/appointments/doctors`, { headers }),
    request.get(`${apiBase}/wards/beds/availability`, { headers }),
    request.get(`${apiBase}/wards/admissions?limit=100&status=ACTIVE`, { headers }),
  ])
  expect(patientsResponse.ok()).toBeTruthy()
  expect(doctorsResponse.ok()).toBeTruthy()
  expect(bedsResponse.ok()).toBeTruthy()
  expect(admissionsResponse.ok()).toBeTruthy()

  const activePatientIds = new Set((await admissionsResponse.json()).data.map((admission: { patientId: string }) => admission.patientId))
  const patient = (await patientsResponse.json()).data.find((candidate: { id: string }) => !activePatientIds.has(candidate.id))
  const doctor = (await doctorsResponse.json()).data[0]
  const availableBeds = (await bedsResponse.json()).data.filter((bed: { status: string }) => bed.status === "AVAILABLE")
  expect(patient).toBeTruthy()
  expect(doctor).toBeTruthy()
  expect(availableBeds.length).toBeGreaterThanOrEqual(2)
  const firstBed = availableBeds[0] as { id: string; bedNumber: string }
  const secondBed = availableBeds[1] as { id: string; bedNumber: string }

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/ward")
  await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()

  const admissionResponse = await request.post(`${apiBase}/wards/admissions`, {
    headers,
    data: { patientId: patient.id, bedId: firstBed.id, attendingDoctorId: doctor.id, admissionType: "PLANNED", admissionReason: "Ward round-trip test" },
  })
  expect(admissionResponse.ok()).toBeTruthy()
  const admission = (await admissionResponse.json()).data as { id: string }
  await page.reload()
  await expectBedState(page, firstBed.bedNumber, "Occupied")

  const transferResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/transfer`, { headers, data: { toBedId: secondBed.id, reason: "Ward round-trip transfer" } })
  expect(transferResponse.ok()).toBeTruthy()
  await page.reload()
  await expectBedState(page, secondBed.bedNumber, "Occupied")
  await expectBedState(page, firstBed.bedNumber, "Available")

  const dischargeResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/discharge`, { headers, data: { dischargeSummary: "Ward round-trip discharge" } })
  expect(dischargeResponse.ok()).toBeTruthy()
  await page.reload()
  await expectBedState(page, secondBed.bedNumber, "Cleaning")
})