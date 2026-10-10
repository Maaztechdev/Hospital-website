import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("pharmacy invoices page exposes search, date filters, status, and paging", async ({ page, request }) => {
  const session = await login(request)
  await openDashboard(page, session, "/dashboard/pharmacy/invoices")

  await expect(page.getByRole("heading", { name: "Pharmacy Invoices" })).toBeVisible()
  await expect(page.getByLabel("Search invoices")).toBeVisible()
  await expect(page.getByLabel("From")).toBeVisible()
  await expect(page.getByLabel("To")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Invoice no." })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Payment method" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible()
  await expect(page.getByText(/Page 1 of/)).toBeVisible()

  await page.getByLabel("Search invoices").fill("not-a-real-invoice")
  await expect(page.getByText("No pharmacy invoices match these filters.")).toBeVisible()
})

test("pharmacy invoice details select thermal printing and show the recorded cashier", async ({ page, request }) => {
  const session = await login(request)
  const item = {
    id: "sale-item-1",
    medicine: { id: "medicine-1", name: "Test Medicine" },
    batch: { id: "batch-1", batchNumber: "BATCH-001", expiryDate: "2027-01-31T00:00:00.000Z" },
    quantity: 2,
    unitPrice: "50",
    discount: "0",
    subtotal: "100",
  }
  const invoice = {
    id: "invoice-test-1",
    invoiceNumber: "PH-TEST-0001",
    createdAt: "2026-06-10T09:30:00.000Z",
    status: "PAID",
    patient: null,
    items: [],
    payments: [],
    subtotal: "100",
    discountAmount: "0",
    taxAmount: "0",
    grandTotal: "100",
    balanceAmount: "0",
  }
  const sale = {
    id: "sale-test-1",
    cashierId: "cashier-1",
    cashier: { id: "cashier-1", name: "Invoice Test Cashier" },
    invoice,
    items: [item],
    paymentMethod: "CASH",
    customerName: "Walk-in Test",
    customerPhone: null,
    totalAmount: "100",
    subtotal: "100",
    discountAmount: "0",
    taxAmount: "0",
  }
  await page.route("**/api/v1/pharmacy/invoices**", async (route) => {
    const details = route.request().url().includes("/invoice-test-1")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: details
          ? { ...invoice, pharmacySale: { ...sale, dispensedBy: [{ id: "cashier-1", name: "Invoice Test Cashier" }], adjustments: [] } }
          : { items: [sale], pagination: { page: 1, limit: 20, total: 1 } },
      }),
    })
  })
  await page.addInitScript(() => { window.print = () => undefined })
  await openDashboard(page, session, "/dashboard/pharmacy/invoices")

  await page.getByRole("button", { name: "View" }).click()
  await expect(page.getByText("Dispensed by Invoice Test Cashier", { exact: true })).toBeVisible()
  await expect(page.getByText("Batch BATCH-001")).toBeVisible()
  await page.getByLabel("Receipt format").selectOption("receipt")
  await page.getByRole("button", { name: "Reprint" }).click()
  await expect(page.locator("#pharmacy-print-root")).toHaveClass(/pharmacy-print-receipt/)
  await expect(page.locator("#pharmacy-print-root")).toContainText("Invoice Test Cashier")
})
