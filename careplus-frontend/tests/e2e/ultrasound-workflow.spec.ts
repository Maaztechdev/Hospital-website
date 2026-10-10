import { test, expect } from "@playwright/test"
import { apiBase, first, login, openDashboard } from "./test-helpers"

test("ultrasound order completes with attachment and cancellation is rejected after completion", async ({ page, request }) => {
  const creator = await login(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const creatorHeaders = { Authorization: `Bearer ${creator.accessToken}` }
  const patient = (await first<Array<{ id: string }>>(request, "/patients?limit=1", headers))[0]
  const suffix = Date.now().toString()
  const technicianResponse = await request.post(`${apiBase}/users`, {
    headers,
    data: {
      name: "E2E Ultrasound Technician",
      email: `ultrasound-e2e-${suffix}@careplus.local`,
      password: "Ultrasound@12345",
      role: "ULTRASOUND_TECH",
    },
  })
  expect(technicianResponse.ok(), await technicianResponse.text()).toBeTruthy()
  const technician = (await technicianResponse.json()).data as { id: string }
  const create = await request.post(`${apiBase}/ultrasound`, { headers: creatorHeaders, data: { patientId: patient.id, examType: `E2E Ultrasound ${Date.now()}`, priority: "ROUTINE" } })
  expect(create.ok()).toBeTruthy()
  const order = (await create.json()).data as { id: string }
  const schedule = await request.patch(`${apiBase}/ultrasound/${order.id}/schedule`, { headers, data: { scheduledAt: "2035-01-15T10:00:00.000Z", technicianId: technician.id } })
  expect(schedule.ok(), await schedule.text()).toBeTruthy()
  expect((await request.patch(`${apiBase}/ultrasound/${order.id}/start`, { headers })).ok()).toBeTruthy()
  expect((await request.patch(`${apiBase}/ultrasound/${order.id}/complete`, { headers, data: { findings: "E2E normal findings", impression: "E2E normal impression", imageUrls: ["https://example.com/e2e-ultrasound.png"] } })).ok()).toBeTruthy()
  expect((await request.patch(`${apiBase}/ultrasound/${order.id}/cancel`, { headers })).status()).toBe(409)
  await openDashboard(page, session, "/dashboard/ultrasound")
  await expect(page.getByRole("heading", { name: /Ultrasound/i })).toBeVisible()
})
