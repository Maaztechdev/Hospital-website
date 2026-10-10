import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("pharmacy voids and returns page exposes date and activity filters", async ({ page, request }) => {
  const session = await login(request)
  await openDashboard(page, session, "/dashboard/pharmacy/sale-adjustments")

  await expect(page.getByRole("heading", { name: "Voided Sales & Returns" })).toBeVisible()
  await expect(page.getByLabel("From")).toBeVisible()
  await expect(page.getByLabel("To")).toBeVisible()
  await expect(page.getByLabel("Activity")).toHaveValue("")
  await expect(page.getByRole("columnheader", { name: "Reason" })).toBeVisible()
  await expect(page.getByText(/Page 1 of/)).toBeVisible()

  await page.getByLabel("Activity").selectOption("RETURN")
  await expect(page.getByLabel("Activity")).toHaveValue("RETURN")
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page.getByLabel("Activity")).toHaveValue("")
})
