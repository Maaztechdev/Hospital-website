import { test, expect } from "@playwright/test"
import { createDoctorAppointment } from "./fixtures"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const patientMrNumber = "MR-2026-000001"

test("returning patient summary loads clinical history, repeats medicines, and saves allergy edits", async ({ page, request }) => {
  test.setTimeout(120_000)
  const fixture = await createDoctorAppointment(request)
  expect(fixture.mrNumber).toBe(patientMrNumber)

  const doctorLogin = await request.post(`${apiBase}/auth/login`, {
    data: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
  })
  expect(doctorLogin.ok()).toBeTruthy()
  const { accessToken } = (await doctorLogin.json()).data as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }
  const patientsResponse = await request.get(`${apiBase}/patients?search=${patientMrNumber}`, { headers })
  expect(patientsResponse.ok()).toBeTruthy()
  const patient = ((await patientsResponse.json()).data as Array<{ id: string }>)[0]
  if (!patient) throw new Error(`Seed patient ${patientMrNumber} was not found`)
  const initialSummaryResponse = await request.get(`${apiBase}/patients/${patient.id}/clinical-summary`, { headers })
  expect(initialSummaryResponse.ok()).toBeTruthy()
  const initialSummary = (await initialSummaryResponse.json()).data as { allergies: string[]; chronicConditions: string[] }

  try {
    await page.goto("/dashboard/login")
    await page.getByLabel("Email").fill("dr.ahmed@careplus.local")
    await page.getByLabel("Password").fill("Doctor@12345")
    await page.getByRole("button", { name: "Sign in to dashboard" }).click()
    await expect(page).toHaveURL(/\/dashboard\/doctor$/, { timeout: 15_000 })
    await page.goto(`/dashboard/doctor/consultation/${fixture.appointmentId}?mr=${patientMrNumber}`)

    await expect(page.getByText("Patient Summary", { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("Penicillin", { exact: true })).toBeVisible()
    await expect(page.getByText("Seasonal allergic rhinitis", { exact: true })).toBeVisible()
    const recentTests = page.locator("details").filter({ hasText: "Recent labs & ultrasounds" })
    await recentTests.locator("summary").click()
    await expect(recentTests.getByText("Complete Blood Count", { exact: true })).toBeVisible()
    await expect(recentTests.getByText("Abdominal Ultrasound", { exact: true })).toBeVisible()

    const previousMedicines = page.locator("details").filter({ hasText: "Previous medicines" })
    await previousMedicines.locator("summary").click()
    await previousMedicines.getByRole("button", { name: "Repeat last prescription" }).click()
    await expect(page.getByRole("combobox", { name: "Medicine 1" })).toHaveValue(/Panadol 500mg/i)

    await page.getByRole("button", { name: "Edit history" }).click()
    await page.getByLabel("Edit patient allergies").fill("Penicillin, E2E Latex")
    await page.getByRole("button", { name: "Save history" }).click()
    await expect(page.getByText("E2E Latex", { exact: true })).toBeVisible({ timeout: 10_000 })
    const savedSummaryResponse = await request.get(`${apiBase}/patients/${patient.id}/clinical-summary`, { headers })
    expect(savedSummaryResponse.ok()).toBeTruthy()
    expect(((await savedSummaryResponse.json()).data as { allergies: string[] }).allergies).toContain("E2E Latex")
  } finally {
    const restoreResponse = await request.patch(`${apiBase}/patients/${patient.id}/clinical-summary`, {
      headers,
      data: {
        allergies: initialSummary.allergies,
        allergiesReviewed: true,
        chronicConditions: initialSummary.chronicConditions,
        chronicConditionsReviewed: true,
      },
    })
    expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy()
  }
})
