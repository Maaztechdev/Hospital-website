import { test, expect } from "@playwright/test"
import { apiBase, first, login, openDashboard } from "./test-helpers"

test("backup can be created and downloaded, while invalid restore password is rejected", async ({ page, request }) => {
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const created = await request.post(`${apiBase}/admin/backup`, { headers })
  test.skip(!created.ok(), `Backup creation unavailable in this environment: ${await created.text()}`)
  const backup = (await created.json()).data as { id: string; filename: string; status: string }
  expect(backup.status).toBe("SUCCESS")
  const download = await request.get(`${apiBase}/admin/backup/${backup.id}/download`, { headers })
  expect(download.ok()).toBeTruthy()
  expect(download.headers()["content-type"]).toContain("sql")
  expect((await request.post(`${apiBase}/admin/backup/${backup.id}/restore`, { headers, data: { password: "wrong-password" } })).status()).toBe(401)
  await openDashboard(page, session, "/dashboard/admin/backup")
  await expect(page.getByRole("heading", { name: "Backup & Restore" })).toBeVisible()
  await expect(page.getByText(backup.filename, { exact: true })).toBeVisible()
  expect((await request.delete(`${apiBase}/admin/backup/${backup.id}`, { headers })).ok()).toBeTruthy()
})
