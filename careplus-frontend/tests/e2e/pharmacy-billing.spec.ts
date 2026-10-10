import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("pharmacy billing page is available and legacy sale modal remains reachable", async ({ page, request }) => {
  const session = await login(request)

  await openDashboard(page, session, "/dashboard/pharmacy/billing")
  await expect(page.getByRole("heading", { name: "Pharmacy Billing" })).toBeVisible()
  await expect(page.getByLabel("Search by medicine, generic name, or barcode")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Current invoice" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Credit" })).toBeEnabled()
  await page.getByRole("tab", { name: "Credit" }).click()
  await expect(page.getByLabel("Paid now (PKR)")).toBeVisible()
  await expect(page.getByLabel("Discount (%)")).toBeVisible()
  await expect(page.getByLabel("Tax amount (PKR)")).toBeVisible()

  await page.goto("/dashboard/pharmacy/legacy-sale")
  await expect(page.getByRole("heading", { name: "New Pharmacy Sale" })).toBeVisible()
})
