import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

function overview(sales: number) {
  return {
    today: { date: "2026-10-08", sales, transactions: 2 },
    lowStock: {
      count: 1,
      items: [{ medicineId: "medicine-1", medicineName: "Low Stock Medicine", genericName: null, batchNumber: "LOW-01", stockQuantity: 2, reorderLevel: 5 }],
    },
    expiring: { count: 3 },
    expired: { count: 1 },
    inventoryValue: { cost: 25000, selling: 37500, units: 50 },
    recentSales: [{
      id: "sale-1",
      invoiceId: "invoice-1",
      invoiceNumber: "PH-2026-0001",
      createdAt: "2026-10-08T10:30:00.000+05:00",
      itemCount: 2,
      paymentMethod: "CASH",
      amount: sales,
    }],
  }
}

test("pharmacy overview renders backend metrics and refreshes after pharmacy mutations", async ({ page, request }) => {
  const session = await login(request)
  let overviewCalls = 0
  await page.route("**/api/v1/pharmacy/overview", async (route) => {
    overviewCalls += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: overview(overviewCalls <= 2 ? 1000 : 1450) }),
    })
  })

  await openDashboard(page, session, "/dashboard/pharmacy")
  await expect(page.getByText("Today's Sales")).toBeVisible()
  await expect(page.getByText("Low Stock Batches")).toBeVisible()
  await expect(page.getByText("Expiring Within 30 Days")).toBeVisible()
  await expect(page.getByText("Expired Batches")).toBeVisible()
  await expect(page.getByText("Selling value PKR 37,500")).toBeVisible()
  await expect(page.getByText("PH-2026-0001")).toBeVisible()
  await expect(page.getByText("Low Stock Medicine")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Khata" })).toBeDisabled()

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: { path: "/pharmacy/invoices/test/void", method: "POST" } }))
  })
  await expect.poll(() => overviewCalls).toBeGreaterThan(2)
  await expect(page.getByText("PKR 1,450", { exact: true }).first()).toBeVisible()
})

test("pharmacy header search queries medicine catalog and opens matching inventory", async ({ page, request }) => {
  const session = await login(request)
  const medicine = {
    id: "medicine-1",
    name: "Searchable Medicine",
    genericName: "Searchable Generic",
    barcode: "123456789",
    strength: "500mg",
    form: "Tablet",
    category: null,
    batches: [{
      id: "batch-1",
      medicineId: "medicine-1",
      batchNumber: "SEARCH-01",
      expiryDate: "2027-12-31T00:00:00.000Z",
      purchasePrice: "10",
      sellingPrice: "20",
      stockQuantity: 8,
      reorderLevel: 5,
      isActive: true,
    }],
    isActive: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }
  await page.route("**/api/v1/pharmacy/medicines**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [medicine] }) })
  })
  await page.route("**/api/v1/pharmacy/overview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: overview(0) }) })
  })

  await openDashboard(page, session, "/dashboard/pharmacy/invoices")
  const search = page.getByPlaceholder("Search medicines by name or barcode…")
  await search.fill("123456789")
  const medicineOption = page.getByRole("button", { name: /Searchable Medicine/ })
  await expect(medicineOption).toBeVisible()
  await medicineOption.click()
  await expect(page).toHaveURL(/\/dashboard\/pharmacy\?search=Searchable%20Medicine/)
  await expect(page.getByRole("cell", { name: "Searchable Medicine" })).toBeVisible()
})
