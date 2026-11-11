import { readFile } from "node:fs/promises"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { formatCurrency, getHospitalDateKey } from "../../src/dashboard/lib/format"
import { toCsv } from "../../src/lib/csv"
import { admin, apiBase, login, openDashboard } from "./test-helpers"

const roleCases = [
  {
    role: "ADMIN",
    path: "/dashboard/admin",
    visible: ["Lab", "Pharmacy", "Ultrasound", "All billing"],
    hidden: ["Lab Reports", "Lab Credit Ledger", "Pharmacy Reports", "Ultrasound Reports"],
  },
  {
    role: "BILLING_MANAGER",
    path: "/dashboard/billing",
    visible: ["All billing", "Lab billing", "Pharmacy billing", "Ultrasound billing"],
    hidden: ["Settings", "Lab Reports"],
  },
  {
    role: "RECEPTIONIST",
    path: "/dashboard/appointments",
    visible: ["Billing", "Collect Payments"],
    hidden: ["All billing", "Lab billing"],
  },
  {
    role: "LAB_TECHNICIAN",
    path: "/dashboard/lab",
    visible: ["Lab Dashboard", "Lab Billing", "Lab Reports"],
    hidden: ["All billing", "Pharmacy"],
  },
  {
    role: "PHARMACIST",
    path: "/dashboard/pharmacy",
    visible: ["Pharmacy", "Billing History", "Invoices"],
    hidden: ["All billing", "Lab billing"],
  },
  {
    role: "ULTRASOUND_TECH",
    path: "/dashboard/ultrasound",
    visible: ["Ultrasound Overview", "Ultrasound Queue", "Ultrasound Billing"],
    hidden: ["All billing", "Pharmacy billing"],
  },
  {
    role: "DOCTOR",
    path: "/dashboard/doctor",
    visible: ["My Dashboard", "Appointments", "Patients"],
    hidden: ["All billing", "Lab billing"],
  },
  {
    role: "NURSE",
    path: "/dashboard/nurse",
    visible: ["Nurse Panel", "Ward Board", "Patients"],
    hidden: ["All billing", "Lab billing"],
  },
] as const

type Session = Awaited<ReturnType<typeof login>>
let patientSequence = 0

test("CSV formatter escapes commas, quotes, and embedded newlines", () => {
  expect(toCsv([["Metric", "Value"], ["Notes", 'She said "hello", then left\nwith the file']]))
    .toBe('Metric,Value\nNotes,"She said ""hello"", then left\nwith the file"')
})

async function createRoleUser(request: APIRequestContext, headers: Record<string, string>, role: string) {
  const email = `billing-nav-${role.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@careplus.local`
  const response = await request.post(`${apiBase}/users`, {
    headers,
    data: { name: `Billing Nav ${role}`, email, password: "Staff@12345", role },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return { email, id: ((await response.json()).data as { id: string }).id }
}

async function createPatient(request: APIRequestContext, headers: Record<string, string>, suffix: string) {
  patientSequence += 1
  const response = await request.post(`${apiBase}/patients`, {
    headers,
    data: {
      firstName: "Consolidation",
      lastName: suffix,
      phone: `0300${String(Date.now()).slice(-7)}${String(patientSequence).padStart(2, "0")}`,
      age: 35,
      gender: "MALE",
      address: "Lahore",
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as { id: string }
}

async function createInvoice(
  request: APIRequestContext,
  headers: Record<string, string>,
  patientId: string,
  department: "LAB" | "PHARMACY",
  amount: number,
) {
  const response = await request.post(`${apiBase}/billing/invoices`, {
    headers,
    data: {
      department,
      patientId,
      items: [{ itemType: "OTHER", description: `Consolidation charge ${amount}`, quantity: 1, unitPrice: amount, discount: 0 }],
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as { id: string; invoiceNumber: string; createdBy: string }
}

async function departmentSummary(request: APIRequestContext, session: Session) {
  const response = await request.get(`${apiBase}/billing/summary`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as {
    departments: Array<{ department: string; collected: number | string }>
  }
}

async function collectPayment(page: Parameters<typeof openDashboard>[0], invoiceNumber: string, amount: number, reference: string) {
  await page.getByPlaceholder("Search patient, MR number, or invoice…").fill(invoiceNumber)
  await page.getByRole("button", { name: `Open invoice ${invoiceNumber}` }).click()
  await page.getByRole("button", { name: "Receive Payment" }).click()
  await page.locator('input[type="number"]').fill(String(amount))
  await page.locator("#payment-reference").fill(reference)
  await page.getByRole("button", { name: "Confirm Payment" }).click()
  await expect(page.getByRole("cell", { name: reference })).toBeVisible()
}

test("department navigation is consolidated without changing role-specific links", async ({ page, request }) => {
  test.setTimeout(120_000)
  const adminSession = await login(request, admin)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }

  for (const scenario of roleCases) {
    const user = await createRoleUser(request, adminHeaders, scenario.role)
    try {
      const session = await login(request, { email: user.email, password: "Staff@12345" })
      await openDashboard(page, session, scenario.path)
      const nav = page.locator("aside nav")
      for (const label of scenario.visible) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible()
      }
      for (const label of scenario.hidden) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0)
      }
      if (scenario.role === "BILLING_MANAGER") {
        await page.goto("/dashboard/lab?section=history")
        await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true")
        await expect(page.getByRole("tab", { name: "Manage" })).toHaveCount(0)
        await expect(page.getByRole("tab", { name: "Work items" })).toHaveCount(0)
      }
    } finally {
      await request.post(`${apiBase}/users/${user.id}/deactivate`, { headers: adminHeaders })
    }
  }
})

test("legacy department links redirect into the appropriate consolidated section", async ({ page, request }) => {
  const session = await login(request, admin)
  const aliases = [
    { oldPath: "/dashboard/lab/catalog", expectedPath: "/dashboard/lab?section=manage&manage=catalog", manage: "catalog" },
    { oldPath: "/dashboard/ultrasound/reports", expectedPath: "/dashboard/ultrasound?section=manage&manage=reports", manage: "reports" },
    { oldPath: "/dashboard/pharmacy/khata", expectedPath: "/dashboard/pharmacy?section=manage&manage=khata", manage: "khata" },
  ]
  await openDashboard(page, session, aliases[0].oldPath)
  for (const alias of aliases) {
    await page.goto(alias.oldPath)
    await expect(page).toHaveURL(new RegExp(alias.expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    await expect(page.getByLabel("Management page")).toHaveValue(alias.manage)
  }
})

test("Admin collects in Lab and Pharmacy and exports every filtered All billing row", async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const session = await login(request, admin)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const baseline = await departmentSummary(request, session)
  const labBefore = Number(baseline.departments.find((entry) => entry.department === "LAB")?.collected ?? 0)
  const pharmacyBefore = Number(baseline.departments.find((entry) => entry.department === "PHARMACY")?.collected ?? 0)
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const paymentPatient = await createPatient(request, headers, `Payment${suffix}`)
  const labInvoice = await createInvoice(request, headers, paymentPatient.id, "LAB", 100)
  const pharmacyInvoice = await createInvoice(request, headers, paymentPatient.id, "PHARMACY", 120)
  const exportPatient = await createPatient(request, headers, `Export${suffix}`)
  const exportInvoices = []
  for (let index = 0; index < 22; index += 1) {
    exportInvoices.push(await createInvoice(request, headers, exportPatient.id, "LAB", 10 + index))
  }

  await openDashboard(page, session, "/dashboard/lab?section=billing")
  await collectPayment(page, labInvoice.invoiceNumber, 25, `ADMIN-LAB-${suffix}`)
  await page.goto("/dashboard/pharmacy?section=billing")
  await collectPayment(page, pharmacyInvoice.invoiceNumber, 40, `ADMIN-PHARM-${suffix}`)

  const updatedSummary = await departmentSummary(request, session)
  const labCollected = Number(updatedSummary.departments.find((entry) => entry.department === "LAB")?.collected ?? 0)
  const pharmacyCollected = Number(updatedSummary.departments.find((entry) => entry.department === "PHARMACY")?.collected ?? 0)
  await page.goto("/dashboard/billing")
  await expect(page.getByTestId("billing-total-LAB")).toContainText(formatCurrency(labBefore + 25))
  await expect(page.getByTestId("billing-total-PHARMACY")).toContainText(formatCurrency(pharmacyBefore + 40))
  await expect(page.getByTestId("billing-total-LAB")).toContainText(formatCurrency(labCollected))
  await expect(page.getByTestId("billing-total-PHARMACY")).toContainText(formatCurrency(pharmacyCollected))

  await page.getByPlaceholder("Search invoice, patient, or MR number…").fill(`Export${suffix}`)
  await page.getByLabel("Department", { exact: true }).selectOption("LAB")
  await page.getByLabel("Status", { exact: true }).selectOption("OUTSTANDING")
  await page.getByLabel("Staff", { exact: true }).selectOption(exportInvoices[0].createdBy)
  const today = getHospitalDateKey()
  await page.getByLabel("Date from").fill(today)
  await page.getByLabel("Date to").fill(today)
  await expect(page.getByText("Page 1 of 2 · 22 records")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByText("Page 2 of 2 · 22 records")).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export CSV" }).click()
  const download = await downloadPromise
  const csv = await readFile(await download.path(), "utf8")
  expect(download.suggestedFilename()).toBe("all-billing-filtered.csv")
  expect(csv.split("\n")).toHaveLength(23)
  expect(csv).toContain(exportInvoices[0].invoiceNumber)

  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
})
