import { test, expect } from "@playwright/test"
import { apiBase, first, login, openDashboard } from "./test-helpers"

test("settings profile and department changes persist after reload", async ({ page, request }) => {
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const originalProfile = await (await request.get(`${apiBase}/settings/hospital-profile`, { headers })).json()
  const profile = { name: `Khalida E2E ${Date.now()}`, registrationNo: "E2E-REG", phone: "+923001234567", email: "e2e@khalida.pk", address: "E2E Address", currency: "PKR", timezone: "Asia/Karachi" }
  expect((await request.put(`${apiBase}/settings/hospital-profile`, { headers, data: profile })).ok()).toBeTruthy()
  const department = await request.post(`${apiBase}/settings/departments`, { headers, data: { name: `E2E Department ${Date.now()}`, status: "ACTIVE", icon: "Stethoscope" } })
  expect(department.ok()).toBeTruthy()
  const departmentId = (await department.json()).data.id
  expect((await request.put(`${apiBase}/settings/departments/${departmentId}`, { headers, data: { name: `E2E Department Edited ${Date.now()}` } })).ok()).toBeTruthy()
  await openDashboard(page, session, "/dashboard/settings")
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await page.getByRole("button", { name: "Departments", exact: true }).click()
  await page.reload()
  await page.getByRole("button", { name: "Departments", exact: true }).click()
  await expect(page.getByRole("cell", { name: /E2E Department Edited/, exact: false }).first()).toBeVisible()
  expect((await request.put(`${apiBase}/settings/hospital-profile`, { headers, data: { ...profile, email: "invalid" } })).status()).toBe(422)
  await request.delete(`${apiBase}/settings/departments/${departmentId}`, { headers })
  await request.put(`${apiBase}/settings/hospital-profile`, { headers, data: originalProfile.data })
})
