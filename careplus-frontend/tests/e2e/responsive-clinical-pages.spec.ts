import { expect, test } from "@playwright/test"
import { createDoctorAppointment } from "./fixtures"
import { login, openDashboard } from "./test-helpers"

test("clinical dashboards avoid page-level horizontal overflow at desktop, tablet, and mobile sizes", async ({ page, request }) => {
  test.setTimeout(90_000)
  const fixture = await createDoctorAppointment(request)
  const session = await login(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })

  const pages = [
    "/dashboard/doctor",
    "/dashboard/appointments",
    `/dashboard/doctor/consultation/${fixture.appointmentId}?mr=${encodeURIComponent(fixture.mrNumber)}`,
    "/dashboard/ward",
    "/dashboard/ot",
  ]
  const viewports = [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]

  let loggedIn = false
  for (const path of pages) {
    if (!loggedIn) {
      await openDashboard(page, session, path)
      loggedIn = true
    } else {
      await page.goto(path)
    }
    if (path === "/dashboard/doctor") {
      await page.getByRole("heading", { name: /Welcome back/i }).waitFor({ state: "visible", timeout: 15_000 })
    } else if (path === "/dashboard/appointments") {
      await page.getByRole("heading", { name: "Appointments" }).first().waitFor({ state: "visible", timeout: 15_000 })
    } else if (path.includes("/consultation/")) {
      await page.getByRole("heading", { name: /Consultation/i }).first().waitFor({ state: "visible", timeout: 15_000 })
    } else if (path === "/dashboard/ward") {
      await page.getByRole("heading", { name: "Ward & Bed Management" }).waitFor({ state: "visible", timeout: 15_000 })
    } else if (path === "/dashboard/ot") {
      await page.getByRole("heading", { name: "Operation Theatre" }).waitFor({ state: "visible", timeout: 15_000 })
    } else {
      await page.locator("h1, h2, table, [role='region']").first().waitFor({ state: "visible", timeout: 15_000 })
    }
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.waitForLoadState("domcontentloaded")
      const dimensions = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      }))
      expect(dimensions.documentWidth, `${path} at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewportWidth + 1)
    }
  }
})
