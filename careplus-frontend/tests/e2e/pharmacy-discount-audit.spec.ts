import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("discount audit page shows filters, pagination, and CSV export", async ({ page, request }) => {
  const session = await login(request)
  await openDashboard(page, session, "/dashboard/pharmacy/discount-audit")

  await expect(page.getByRole("heading", { name: "Discount Audit" })).toBeVisible()
  await expect(page.getByLabel("From")).toBeVisible()
  await expect(page.getByLabel("To")).toBeVisible()
  await expect(page.getByLabel("Cashier")).toBeVisible()
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled()
  await expect(page.getByText("Discounts Given:")).toBeVisible()

  await page.goto("/dashboard/settings")
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await page.getByRole("button", { name: "Pharmacy Discounts" }).click()
  await expect(page.getByLabel("Cashier maximum discount (%)")).toHaveValue("10")
})
