import { test, expect } from "@playwright/test"
import { apiBase, login, openDashboard } from "./test-helpers"

test("audit logs filter by date, user, and action while null users render as System", async ({ page, request }) => {
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  await page.route("**/api/v1/audit-logs**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: [{ id: "audit-e2e", module: "backup", entityType: "Backup", entityId: "e2e", action: "BACKUP", details: "Filtered backup", createdAt: "2026-09-16T12:00:00.000Z", user: null }], pagination: { page: 1, limit: 50, total: 1 } }) })
  })
  await openDashboard(page, session, "/dashboard/audit-logs")
  await expect(page).toHaveURL(/\/dashboard\/audit-logs$/)
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible()
  await page.getByRole("combobox", { name: "Action" }).selectOption("all")
  await expect(page.getByRole("row", { name: /Filtered backup System \(System\)/ })).toBeVisible()
  const filteredResponse = await request.get(`${apiBase}/audit-logs?from=2026-09-16T00:00:00.000Z&to=2026-09-16T23:59:59.999Z&action=BACKUP&userId=${session.user.id}`, { headers })
  expect(filteredResponse.ok(), await filteredResponse.text()).toBeTruthy()
})
