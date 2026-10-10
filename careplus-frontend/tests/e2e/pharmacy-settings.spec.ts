import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("Admin updates pharmacy settings, configures a PIN, uploads a logo, and uses the shared backup service", async ({ page, request }) => {
  const session = await login(request)
  let settings = {
    name: "Pharmacy",
    address: "",
    phone: "",
    currency: "PKR",
    defaultReceiptFormat: "a4",
    cashierMaxDiscountPercent: 10,
    lossAlertThreshold: 0,
    defaultLowStockLevel: 10,
    logoUrl: null,
    adminPinConfigured: false,
    lastBackupAt: null,
  }
  let updatedSettings: Record<string, unknown> | undefined
  let pinPayload: Record<string, unknown> | undefined
  let backupCreated = false
  let logoUploaded = false

  await page.route("**/api/v1/pharmacy/settings", async (route) => {
    if (route.request().method() === "PUT") {
      updatedSettings = route.request().postDataJSON() as Record<string, unknown>
      settings = { ...settings, ...(updatedSettings as typeof settings) }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: settings }) })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: settings }) })
  })
  await page.route("**/api/v1/pharmacy/settings/admin-pin", async (route) => {
    pinPayload = route.request().postDataJSON() as Record<string, unknown>
    settings.adminPinConfigured = true
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { adminPinConfigured: true } }) })
  })
  await page.route("**/api/v1/pharmacy/settings/logo", async (route) => {
    logoUploaded = route.request().method() === "POST"
    settings.logoUrl = "/api/v1/files/pharmacy-profile/test-logo.png"
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { logoUrl: settings.logoUrl } }) })
  })
  await page.route("**/api/v1/admin/backup", async (route) => {
    if (route.request().method() === "POST") {
      backupCreated = true
      settings.lastBackupAt = "2026-10-10T09:00:00.000Z"
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "backup-1" } }) })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) })
  })

  await openDashboard(page, session, "/dashboard/pharmacy/settings")
  await expect(page.getByRole("heading", { name: "Pharmacy Settings" })).toBeVisible()
  await page.getByLabel("Pharmacy name").fill("Khalida Pharmacy")
  await page.getByLabel("Phone").fill("03001234567")
  await page.getByLabel("Address").fill("Main Road")
  await page.getByLabel("Cashier max discount (%)").fill("8")
  await page.getByLabel("Loss alert threshold (PKR)").fill("250")
  await page.getByLabel("Default low-stock level (units)").fill("12")
  await page.getByLabel("Default receipt format").selectOption("receipt")
  await page.getByRole("button", { name: "Save settings" }).click()
  await expect.poll(() => updatedSettings).toMatchObject({
    name: "Khalida Pharmacy",
    phone: "03001234567",
    address: "Main Road",
    cashierMaxDiscountPercent: 8,
    lossAlertThreshold: 250,
    defaultLowStockLevel: 12,
    defaultReceiptFormat: "receipt",
  })

  await page.getByLabel("New Admin PIN").fill("123456")
  await page.getByLabel("Confirm new PIN").fill("123456")
  await page.getByRole("button", { name: "Set Admin PIN" }).click()
  await expect.poll(() => pinPayload).toMatchObject({ newPin: "123456" })

  await page.locator('input[type="file"]').setInputFiles({ name: "pharmacy-logo.png", mimeType: "image/png", buffer: Buffer.from("logo") })
  await expect.poll(() => logoUploaded).toBe(true)
  await page.getByRole("button", { name: "Create backup" }).click()
  await expect.poll(() => backupCreated).toBe(true)
  await expect(page.getByText(/Last successful backup: 10 Oct 2026/)).toBeVisible()
})
