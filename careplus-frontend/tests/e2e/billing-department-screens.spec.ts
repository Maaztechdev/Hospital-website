import { test, expect } from "@playwright/test"
import { admin, apiBase, login, openDashboard } from "./test-helpers"

const departmentCases = [
  {
    name: "Lab Technician",
    role: "LAB_TECHNICIAN",
    department: "LAB",
    path: "/dashboard/lab/billing",
    forbiddenDepartment: "PHARMACY",
  },
  {
    name: "Ultrasound staff",
    role: "ULTRASOUND_TECH",
    department: "ULTRASOUND",
    path: "/dashboard/ultrasound/billing",
    forbiddenDepartment: "LAB",
  },
  {
    name: "Pharmacist",
    role: "PHARMACIST",
    department: "PHARMACY",
    path: "/dashboard/pharmacy/invoice-history",
    forbiddenDepartment: "ULTRASOUND",
  },
  {
    name: "Receptionist",
    role: "RECEPTIONIST",
    department: "LAB",
    path: "/dashboard/billing/collect",
    forbiddenDepartment: "IPD",
  },
] as const

async function createInvoice(request: Parameters<typeof login>[0], department: string) {
  const adminSession = await login(request, admin)
  const headers = { Authorization: `Bearer ${adminSession.accessToken}` }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const patientResponse = await request.post(`${apiBase}/patients`, {
    headers,
    data: {
      firstName: "Billing",
      lastName: `Screen${suffix}`,
      phone: `0300${suffix.slice(-7)}`,
      age: 35,
      gender: "MALE",
      address: "Lahore",
    },
  })
  expect(patientResponse.ok(), await patientResponse.text()).toBeTruthy()
  const patient = (await patientResponse.json()).data as { id: string }

  const invoiceResponse = await request.post(`${apiBase}/billing/invoices`, {
    headers,
    data: {
      department,
      patientId: patient.id,
      items: [{ itemType: "OTHER", description: "Billing screen test charge", quantity: 1, unitPrice: 100, discount: 0 }],
    },
  })
  expect(invoiceResponse.ok(), await invoiceResponse.text()).toBeTruthy()
  return {
    adminSession,
    invoice: (await invoiceResponse.json()).data as { id: string; invoiceNumber: string },
  }
}

for (const scenario of departmentCases) {
  test(`${scenario.name} collects an invoice, sees payment history, and cannot access IPD/other billing`, async ({ page, request }) => {
    test.setTimeout(90_000)
    const { adminSession, invoice } = await createInvoice(request, scenario.department)
    const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
    const email = `billing-e2e-${scenario.role.toLowerCase()}-${Date.now()}@careplus.local`
    const userResponse = await request.post(`${apiBase}/users`, {
      headers: adminHeaders,
      data: {
        name: `Billing ${scenario.name}`,
        email,
        password: "Staff@12345",
        role: scenario.role,
      },
    })
    expect(userResponse.ok(), await userResponse.text()).toBeTruthy()
    const user = (await userResponse.json()).data as { id: string }

    try {
      const session = await login(request, { email, password: "Staff@12345" })
      const headers = { Authorization: `Bearer ${session.accessToken}` }
      const forbidden = await request.get(
        `${apiBase}/billing/invoices?department=${scenario.forbiddenDepartment}&page=1&limit=20`,
        { headers },
      )
      expect(forbidden.status()).toBe(403)

      await page.setViewportSize({ width: 390, height: 844 })
      await openDashboard(page, session, scenario.path)
      const openInvoice = page.getByRole("button", { name: `Open invoice ${invoice.invoiceNumber}` })
      await expect(openInvoice).toBeVisible()
      await openInvoice.click()

      await expect(page.getByRole("button", { name: "Receive Payment" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Void Invoice" })).toHaveCount(0)
      await page.getByRole("button", { name: "Receive Payment" }).click()
      await page.locator('input[type="number"]').fill("25")
      await page.locator("#payment-reference").fill("BILLING-E2E-REFERENCE")
      await page.getByRole("button", { name: "Confirm Payment" }).click()
      await expect(page.getByRole("cell", { name: "Collected" })).toBeVisible()
      await expect(page.getByRole("cell", { name: "BILLING-E2E-REFERENCE" })).toBeVisible()
      const receipt = page.locator("#pharmacy-print-root")
      await expect(receipt).toBeAttached()
      await expect(receipt).toContainText(invoice.invoiceNumber)
      await page.evaluate(() => { window.print = () => undefined })
      await page.getByRole("button", { name: "Print Receipt" }).click()
      await expect.poll(() => page.locator("body").getAttribute("data-careplus-printing")).toBe("pharmacy-print-root")

      if (scenario.name !== "Receptionist") {
        await page.goto(scenario.path)
        await page.getByRole("tab", { name: "Invoice history" }).click()
        const historyInvoice = page.getByRole("button", { name: `Open invoice ${invoice.invoiceNumber}` })
        await expect(historyInvoice).toBeVisible()
        await expect(historyInvoice).toContainText("Paid")
      }

      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(pageWidth).toBeLessThanOrEqual(390)
    } finally {
      await request.post(`${apiBase}/users/${user.id}/deactivate`, { headers: adminHeaders })
    }
  })
}
