import { test, expect, type APIRequestContext } from "@playwright/test"
import { createDoctorAppointment } from "./fixtures"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"

test("consultation record view is accessible after consultation completion", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })

  const fixture = await createDoctorAppointment(request)

  const adminLogin = await request.post(`${apiBase}/auth/login`, { data: { email: "admin@careplus.local", password: "Admin@12345" } })
  expect(adminLogin.ok()).toBeTruthy()
  const adminToken = (await adminLogin.json()).data.accessToken as string

  const consultationResponse = await request.post(`${apiBase}/consultations`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      appointmentId: fixture.appointmentId,
      diagnosis: "E2E test diagnosis for read-only record verification",
    },
  })
  expect(consultationResponse.ok(), await consultationResponse.text()).toBeTruthy()
  const consultation = (await consultationResponse.json()).data as { id: string }

  await page.goto("/dashboard/login")
  await page.getByLabel("Email").fill("dr.ahmed@careplus.local")
  await page.getByLabel("Password").fill("Doctor@12345")
  await page.getByRole("button", { name: "Sign in to dashboard" }).click()
  await expect(page).toHaveURL(/\/dashboard\/doctor$/, { timeout: 15000 })

  await page.goto(`/dashboard/doctor/consultation-record/${consultation.id}`)
  await expect(page).toHaveURL(new RegExp(`/dashboard/doctor/consultation-record/${consultation.id}`), { timeout: 15000 })
  await expect(page.locator("body")).toContainText("E2E test diagnosis for read-only record verification", { timeout: 15000 })
  await expect(page.locator("body")).toContainText("Consultation", { timeout: 15000 })
})

test("OPD queue page loads without errors for doctor", async ({ page, request }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1280, height: 900 })

  // Create an appointment
  const fixture = await createDoctorAppointment(request)

  // Login as doctor
  await page.goto("/dashboard/login")
  await page.getByLabel("Email").fill("dr.ahmed@careplus.local")
  await page.getByLabel("Password").fill("Doctor@12345")
  await page.getByRole("button", { name: "Sign in to dashboard" }).click()

  // Wait for dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 10000 })

  // Navigate to OPD queue
  await page.goto("/dashboard/doctor/opd-queue")
  await page.waitForLoadState("networkidle")

  // Page should not have errors (check for basic navigation success)
  // OPD Queue either shows queue content or empty state
  const pageContent = await page.locator("body").textContent()
  expect(pageContent).toBeTruthy()
  
  // Verify not an error page
  expect(pageContent).not.toContain("500 Internal")
  expect(pageContent).not.toContain("error occurred")
})




