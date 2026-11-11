import { test, expect, type APIRequestContext } from "@playwright/test"
import { admin, apiBase, login, openDashboard } from "./test-helpers"

interface SetupResult {
  orderId: string
  invoiceId: string
}

async function setupLabOrderWithInvoice(request: APIRequestContext): Promise<SetupResult> {
  const adminSession = await login(request, admin)
  const headers = { Authorization: `Bearer ${adminSession.accessToken}` }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`

  // 1. Create patient
  const patientRes = await request.post(`${apiBase}/patients`, {
    headers,
    data: {
      firstName: "LabGating",
      lastName: `Patient${suffix}`,
      phone: `0300${suffix.slice(-7)}`,
      age: 28,
      gender: "FEMALE",
      address: "Lahore",
    },
  })
  expect(patientRes.ok(), await patientRes.text()).toBeTruthy()
  const patient = (await patientRes.json()).data

  // 2. Get tests
  const testsRes = await request.get(`${apiBase}/lab/tests?limit=1`, { headers })
  expect(testsRes.ok(), await testsRes.text()).toBeTruthy()
  const testItems = (await testsRes.json()).data
  const testId = testItems.items ? testItems.items[0].id : testItems[0].id

  // 3. Create lab order
  const orderRes = await request.post(`${apiBase}/lab/orders`, {
    headers,
    data: {
      patientId: patient.id,
      testId,
      priority: "ROUTINE",
      sampleType: "Blood",
    },
  })
  expect(orderRes.ok(), await orderRes.text()).toBeTruthy()
  const order = (await orderRes.json()).data

  // 4. Generate invoice
  const invoiceRes = await request.post(`${apiBase}/lab/orders/${order.id}/invoice`, { headers })
  expect(invoiceRes.ok(), await invoiceRes.text()).toBeTruthy()
  const invoice = (await invoiceRes.json()).data

  return { orderId: order.id, invoiceId: invoice.id }
}

test.describe("Lab & Billing Payment and Void Role Gating", () => {
  let fixture: SetupResult

  test.beforeAll(async ({ request }) => {
    fixture = await setupLabOrderWithInvoice(request)
  })

  test("Role LAB_TECHNICIAN on LabOrderDetail: Receive Payment is visible, Void Invoice is hidden", async ({ page, request }) => {
    const session = await login(request, { email: "labtech@careplus.local", password: "Staff@12345" })
    await openDashboard(page, session, `/dashboard/lab/${fixture.orderId}`)

    await expect(page.getByRole("heading", { name: "Billing & Payments" })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("button", { name: "Receive Payment" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Void Invoice" })).toHaveCount(0)
  })

  test("Role RECEPTIONIST on LabOrderDetail: Receive Payment is visible, Void Invoice is hidden", async ({ page, request }) => {
    const session = await login(request, { email: "reception@careplus.local", password: "Staff@12345" })
    await openDashboard(page, session, `/dashboard/lab/${fixture.orderId}`)

    await expect(page.getByRole("heading", { name: "Billing & Payments" })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("button", { name: "Receive Payment" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Void Invoice" })).toHaveCount(0)
  })

  test("Role ADMIN on LabOrderDetail: Receive Payment is visible and Void Invoice is visible", async ({ page, request }) => {
    const session = await login(request, admin)
    await openDashboard(page, session, `/dashboard/lab/${fixture.orderId}`)

    await expect(page.getByRole("heading", { name: "Billing & Payments" })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("button", { name: "Receive Payment" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Void Invoice" })).toBeVisible()
  })

  test("Role BILLING_MANAGER on InvoiceDetail: Receive Payment is visible and Void Invoice is visible", async ({ page, request }) => {
    const session = await login(request, { email: "billing-manager@careplus.local", password: "Billing@12345" })
    await openDashboard(page, session, `/dashboard/billing/${fixture.invoiceId}`)

    await expect(page.getByRole("button", { name: "Receive Payment" })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole("button", { name: "Void Invoice" })).toBeVisible()
  })
})
