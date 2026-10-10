import { test, expect } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { login, openDashboard } from "./test-helpers"

test("pharmacy reports apply date filters, display backend metrics, and export CSV", async ({ page, request }) => {
  const session = await login(request)
  const report = {
    period: "today",
    dateRange: { from: "2026-10-08", to: "2026-10-08" },
    summary: { totalSalesRevenue: 1200, transactions: 4, discountsGiven: 50, taxesCollected: 60, returns: 100, netRevenue: 1100, grossProfit: 350 },
    categories: { items: [{ name: "Pain Relief", quantity: 8, revenue: 1200 }, { name: 'Pain Relief, "Special"\nCategory', quantity: 1, revenue: 100 }], pagination: { page: 1, limit: 20, total: 2, pages: 1 } },
    topMedicines: { items: [{ id: "medicine-1", name: "Test Paracetamol", genericName: "Paracetamol", quantity: 8, revenue: 1200 }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
    lowStock: { items: [{ medicineName: "Low Stock Medicine", genericName: null, batchNumber: "LOW-01", stockQuantity: 2, reorderLevel: 5, expiryDate: "2027-01-01" }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
    expiringSoon: { items: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 }, days: 30 },
    expiredStock: { items: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } },
    salesByCashier: { items: [{ id: "cashier-1", name: "Test Cashier", transactions: 4, revenue: 1200 }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
    salesByPaymentMethod: { items: [{ paymentMethod: "CASH", transactions: 4, revenue: 1200 }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
  }
  const reportRequests: URL[] = []
  await page.route("**/api/v1/pharmacy/reports**", async (route) => {
    const url = new URL(route.request().url())
    reportRequests.push(url)
    const period = url.searchParams.get("period") ?? "today"
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          ...report,
          period,
          dateRange: period === "custom"
            ? { from: url.searchParams.get("from"), to: url.searchParams.get("to") }
            : report.dateRange,
        },
      }),
    })
  })

  await openDashboard(page, session, "/dashboard/pharmacy/reports")
  await expect(page.getByRole("heading", { name: "Pharmacy Reports" })).toBeVisible()
  await expect(page.locator("p").filter({ hasText: "PKR 1,200" }).first()).toBeVisible()
  await expect(page.getByText("Pain Relief", { exact: true })).toBeVisible()
  await expect(page.getByText("Test Paracetamol")).toBeVisible()
  await expect(page.getByText("Gross Profit")).toBeVisible()

  await page.getByRole("tab", { name: "Week" }).click()
  await expect.poll(() => reportRequests.at(-1)?.searchParams.get("period")).toBe("week")
  await page.getByLabel("From").fill("2026-10-01")
  await page.getByLabel("To").fill("2026-10-07")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect.poll(() => reportRequests.at(-1)?.searchParams.get("period")).toBe("custom")
  expect(reportRequests.at(-1)?.searchParams.get("from")).toBe("2026-10-01")
  expect(reportRequests.at(-1)?.searchParams.get("to")).toBe("2026-10-07")

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export CSV" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("pharmacy-report-custom.csv")
  const csv = await readFile(await file.path(), "utf8")
  expect(csv).toContain('"Pain Relief, ""Special""\nCategory"')
})
