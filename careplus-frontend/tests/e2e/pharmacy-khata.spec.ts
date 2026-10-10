import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("Khata lists balances, records a receipt, and exposes printable payment details", async ({ page, request }) => {
  const session = await login(request)
  let balance = 125
  let paymentRequests = 0
  const account = {
    id: "khata-account-1",
    type: "RECEIVABLE",
    patientId: null,
    customerName: "Khata Walk-in",
    customerPhone: "03001234567",
    createdAt: "2026-10-08T08:00:00.000Z",
    patient: null,
    balance,
    lastActivity: {
      id: "credit-entry-1", accountId: "khata-account-1", invoiceId: "invoice-1",
      type: "SALE_ON_CREDIT", amount: 200, balanceAfter: 125, paymentMethod: null,
      notes: "Credit sale", createdBy: "user-1", createdAt: "2026-10-08T09:00:00.000Z",
    },
  }
  await page.route("**/api/v1/pharmacy/khata/accounts**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (method === "GET" && url.pathname === "/api/v1/pharmacy/khata/accounts") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [{ ...account, balance }], pagination: { page: 1, limit: 50, total: 1, pages: 1 }, summary: { receivable: balance, payable: 0 } } }),
      })
      return
    }
    if (method === "GET" && url.pathname.endsWith("/khata/accounts/khata-account-1")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { account, balance, entries: [account.lastActivity], pagination: { page: 1, limit: 50, total: 1, pages: 1 } } }),
      })
      return
    }
    if (method === "POST" && url.pathname.endsWith("/payments")) {
      paymentRequests += 1
      const entry = {
        id: `payment-${paymentRequests}`, accountId: account.id, invoiceId: null,
        type: "PAYMENT_RECEIVED", amount: -25, balanceAfter: balance - 25,
        paymentMethod: "CASH", notes: "Part payment", createdBy: "user-1", createdAt: "2026-10-08T10:00:00.000Z",
      }
      balance -= 25
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: { entry, balance }, message: "Khata payment recorded" }) })
      return
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, message: "Unexpected Khata API request" }) })
  })

  await openDashboard(page, session, "/dashboard/pharmacy/khata")
  await expect(page.getByRole("heading", { name: "Pharmacy Khata" })).toBeVisible()
  await expect(page.getByText("Khata Walk-in")).toBeVisible()
  await expect(page.getByText("Receivable", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open ledger" }).click()
  await expect(page.getByRole("heading", { name: /Khata Walk-in · Ledger/ })).toBeVisible()
  await page.getByRole("button", { name: "Receive payment" }).click()
  const paymentDialog = page.getByRole("dialog").last()
  await paymentDialog.getByLabel("Amount (PKR)").fill("25")
  await paymentDialog.getByLabel("Note (optional)").fill("Part payment")
  await paymentDialog.getByRole("button", { name: "Record payment" }).click()
  await expect(page.getByText("Payment receipt ready")).toBeVisible()
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible()
  await page.getByRole("button", { name: "Done" }).last().click()
  await expect(page.getByText("PKR 100", { exact: true }).first()).toBeVisible()
  expect(paymentRequests).toBe(1)
})
