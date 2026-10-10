import { expect, test } from "@playwright/test"
import { first, login, openDashboard } from "./test-helpers"

test("clinical dashboards avoid page-level horizontal overflow at desktop, tablet, and mobile sizes", async ({ page, request }) => {
  test.setTimeout(60_000)
  const session = await login(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const appointments = await first<Array<{ id: string; patient: { mrNumber: string } }>>(request, "/appointments?limit=100", headers)
  expect(appointments.length).toBeGreaterThan(0)
  const appointment = appointments[0]
  const pages = [
    "/dashboard/doctor",
    "/dashboard/appointments",
    `/dashboard/doctor/consultation/${appointment.id}?mr=${encodeURIComponent(appointment.patient.mrNumber)}`,
    "/dashboard/ward",
    "/dashboard/ot",
  ]
  const viewports = [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]

  for (const path of pages) {
    await openDashboard(page, session, path)
    await page.waitForLoadState("networkidle")
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
