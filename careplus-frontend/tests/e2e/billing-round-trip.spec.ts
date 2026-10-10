import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

test("billing mutations persist after reload and match backend records", async ({ page, request }) => {
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const patientsResponse = await request.get(`${apiBase}/patients?limit=1`, { headers })
  expect(patientsResponse.ok()).toBeTruthy()
  const patient = (await patientsResponse.json()).data[0] as { id: string; mrNumber: string }

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/billing")
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "New Invoice" }).click()
  const createDialog = page.getByRole("dialog")
  await createDialog.getByPlaceholder("Search by name, MR number or phone").fill(patient.mrNumber)
  await createDialog.locator('[role="listbox"] [role="option"]').first().click()
  await createDialog.locator("input").nth(0).fill("Round trip consultation")
  await createDialog.locator("input").nth(2).fill("100")
  await createDialog.getByRole("button", { name: "Save Invoice" }).click()
  await expect(page).toHaveURL(/\/dashboard\/billing\/[0-9a-f-]+$/)

  const invoiceId = page.url().split("/").pop()!
  const createdResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  expect(createdResponse.ok()).toBeTruthy()
  const created = (await createdResponse.json()).data
  expect(created.status).toBe("FINALIZED")
  expect(Number(created.grandTotal)).toBe(100)

  await page.getByRole("button", { name: "Receive Payment" }).click()
  const paymentDialog = page.getByRole("dialog")
  await paymentDialog.locator("input").nth(0).fill("40")
  await paymentDialog.getByRole("button", { name: "Confirm Payment" }).click()
  await expect(page.getByText("Payment received", { exact: true })).toBeVisible()

  const partialResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  const partial = (await partialResponse.json()).data
  expect(partial.status).toBe("PARTIAL")
  expect(Number(partial.paidAmount)).toBe(40)
  expect(partial.payments).toHaveLength(1)

  await page.emulateMedia({ media: "print" })
  const printRoot = page.locator("#invoice-print-root")
  await expect(printRoot).toBeVisible()
  await expect(printRoot).toContainText(patient.mrNumber)
  await expect(printRoot).toContainText("Round trip consultation")
  await expect(printRoot).toContainText("Payment History")
  await expect(printRoot).toContainText("Thank you for choosing")
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toBeVisible()
  const invoicePdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })
  const pdfSource = Buffer.from(invoicePdf).toString("latin1")
  const pageTree = pdfSource.match(/\/Type\s*\/Pages\b[\s\S]{0,500}?\/Count\s+(\d+)/)
  expect(pageTree?.[1]).toBe("1")
  await page.emulateMedia({ media: "screen" })

  await page.getByRole("button", { name: "Void Invoice" }).click()
  const voidDialog = page.getByRole("dialog")
  await voidDialog.locator("textarea").fill("Round trip test cleanup")
  await voidDialog.getByRole("button", { name: "Void Invoice" }).click()
  await expect(page.getByText("Invoice voided", { exact: true })).toBeVisible()

  const voidedResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  const voided = (await voidedResponse.json()).data
  expect(voided.status).toBe("VOID")
  expect(Number(voided.paidAmount)).toBe(40)
  expect(voided.voidReason).toBe("Round trip test cleanup")
  expect(voided.payments).toHaveLength(0)

  await page.reload()
  await expect(page.getByText("Void", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Reason: Round trip test cleanup/)).toBeVisible()
  await expect(page.getByText("No payments recorded yet.", { exact: true })).toBeVisible()
})