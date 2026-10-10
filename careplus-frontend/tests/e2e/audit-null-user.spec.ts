import { test, expect, type Page } from "@playwright/test"

async function signIn(page: Page) {
  await page.goto("/dashboard/login")
  await page.getByLabel("Email").fill("admin@careplus.local")
  await page.getByLabel("Password").fill("Admin@12345")
  await page.getByRole("button", { name: "Sign in to dashboard" }).click()
  await expect(page).toHaveURL(/\/dashboard\/admin$/)
}

test("renders audit entries with a null user as System", async ({ page }) => {
  await page.route("**/api/v1/audit-logs**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ id: "audit-null-user", module: "system", entityType: "Backup", entityId: "backup-1", action: "BACKUP", details: "Automated backup", createdAt: "2026-09-16T12:00:00.000Z", user: null }],
        pagination: { page: 1, limit: 50, total: 1 },
      }),
    })
  })

  await signIn(page)
  await page.goto("/dashboard/audit-logs")
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible()
  await expect(page.getByRole("row", { name: /Automated backup System \(System\)/ })).toBeVisible()
  await expect(page.getByText("undefined", { exact: true })).toHaveCount(0)
})
