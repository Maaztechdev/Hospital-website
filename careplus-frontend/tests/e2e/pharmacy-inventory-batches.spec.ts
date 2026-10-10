import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("inventory shows batch details and records stock-in references per batch", async ({ page, request }) => {
  const session = await login(request)
  const medicine = {
    id: "medicine-batch-1",
    name: "Batch A Medicine",
    genericName: "Generic A",
    barcode: "BATCHBARCODE1",
    strength: "250mg",
    form: "Capsule",
    unitType: "CAPSULE",
    manufacturer: "Example manufacturer",
    category: null,
    isActive: true,
    batches: [
      {
        id: "batch-expired",
        medicineId: "medicine-batch-1",
        batchNumber: "OLD-01",
        expiryDate: "2020-01-01T00:00:00.000Z",
        purchasePrice: "10",
        sellingPrice: "15",
        stockQuantity: 3,
        reorderLevel: 1,
        isActive: true,
        supplier: { id: "supplier-1", name: "Old supplier" },
      },
      {
        id: "batch-active",
        medicineId: "medicine-batch-1",
        batchNumber: "CURRENT-01",
        expiryDate: "2027-12-31T00:00:00.000Z",
        purchasePrice: "12",
        sellingPrice: "18",
        stockQuantity: 7,
        reorderLevel: 2,
        isActive: true,
        supplier: { id: "supplier-2", name: "Current supplier" },
      },
    ],
  }
  let stockInPayload: Record<string, unknown> | undefined
  await page.route("**/api/v1/pharmacy/medicines**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [medicine] }) })
  })
  await page.route("**/api/v1/pharmacy/overview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {
      today: { date: "2026-10-09", sales: 0, transactions: 0 },
      lowStock: { count: 0, items: [] },
      expiring: { count: 0 },
      expired: { count: 1 },
      inventoryValue: { cost: 120, selling: 180, units: 7 },
      recentSales: [],
    } }) })
  })
  await page.route("**/api/v1/pharmacy/stock-movements**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) })
  })
  await page.route("**/api/v1/prescriptions**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) })
  })
  await page.route("**/api/v1/pharmacy/categories", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) })
  })
  await page.route("**/api/v1/pharmacy/stock-in", async (route) => {
    stockInPayload = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "batch-created" } }) })
  })
  await page.route("**/api/v1/pharmacy/write-off", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) })
  })

  await openDashboard(page, session, "/dashboard/pharmacy")
  const medicineRow = page.getByRole("row").filter({ hasText: "Batch A Medicine" })
  await expect(medicineRow).toBeVisible()
  await expect(medicineRow.getByRole("cell", { name: "10", exact: true })).toBeVisible()
  await medicineRow.getByRole("button", { name: "Show batches for Batch A Medicine" }).click()
  await expect(page.getByRole("table").getByText("Batch OLD-01", { exact: false }).first()).toBeVisible()
  await expect(page.getByRole("table").getByText("Batch CURRENT-01", { exact: false }).first()).toBeVisible()
  await expect(page.getByRole("table").getByText("Expired", { exact: true }).first()).toBeVisible()

  await page.getByRole("button", { name: "Expire / Write-off" }).click()
  await expect(page.getByRole("heading", { name: /Expire \/ Write-off/ })).toBeVisible()
  await page.getByPlaceholder("e.g. 5 or -5").fill("2")
  await page.getByPlaceholder("e.g. Patient returned unused medicine").fill("Expired stock disposal")
  await page.getByRole("button", { name: "Confirm Adjustment" }).click()
  await expect(page.getByRole("heading", { name: /Expire \/ Write-off/ })).toBeHidden()

  await medicineRow.getByRole("button", { name: "Stock In" }).click()
  await page.getByPlaceholder("Batch number").fill("NEW-02")
  await page.getByPlaceholder("DD/MM/YYYY").fill("31/12/2027")
  await page.getByPlaceholder("0", { exact: true }).fill("5")
  await page.getByPlaceholder("0.00").nth(0).fill("12.50")
  await page.getByPlaceholder("0.00").nth(1).fill("20")
  await page.getByPlaceholder("Supplier name (optional)").fill("New supplier")
  await page.getByPlaceholder("Invoice or receipt reference").fill("SUP-2027-01")
  await page.getByRole("button", { name: "Confirm Stock In" }).click()
  await expect.poll(() => stockInPayload).toMatchObject({
    medicineId: "medicine-batch-1",
    batchNumber: "NEW-02",
    expiryDate: "2027-12-31",
    quantity: 5,
    purchasePrice: 12.5,
    sellingPrice: 20,
    supplierName: "New supplier",
    invoiceReference: "SUP-2027-01",
  })
})
