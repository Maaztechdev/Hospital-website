import { test, expect } from "@playwright/test"
import { login, openDashboard } from "./test-helpers"

test("pharmacy displays prescription patient and doctor and invoices a FEFO dispense", async ({ page, request }) => {
  const session = await login(request)
  const prescriptionId = "2a9d99a5-23dd-4bdd-9ee4-aebf84750bd1"
  const prescriptionItemId = "e3268278-1b1e-4b5c-a89f-9969d5d19eaf"
  const medicineId = "a9c302e2-71ae-4ed8-98be-65866bc2748d"
  let dispensed = false
  let postedItems: Array<{ prescriptionItemId: string; quantity: number }> | undefined

  const prescription = {
    id: prescriptionId,
    consultationId: "2401bbd8-7858-4dd8-b1c8-b54f4ca30ccc",
    patientId: "2e8a5802-c010-46cf-9d09-c53ad9e86b68",
    doctorId: "8d2edb31-f6a2-47f4-bba2-51acfab50f64",
    status: "SIGNED",
    createdAt: "2026-06-15T09:00:00.000Z",
    items: [{
      id: prescriptionItemId,
      medicineId,
      isCatalogItem: true,
      requiresPharmacistReview: false,
      medicineName: "E2E Pharmacy Medicine 10 mg",
      doseAmount: 1,
      doseUnit: "tablet",
      frequencyCode: "OD",
      durationValue: 3,
      durationUnit: "days",
      quantityDispensed: 0,
    }],
    patient: { firstName: "Ayesha", lastName: "Malik", mrNumber: "MR-2026-000001" },
    doctor: { user: { name: "Dr. Ahmed Khan" } },
  }

  await page.route("**/api/v1/pharmacy/medicines**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: [{
        id: medicineId,
        name: "E2E Pharmacy Medicine",
        genericName: "Test generic",
        strength: "10 mg",
        form: "Tablet",
        unitType: "TABLET",
        manufacturer: "CarePlus",
        barcode: null,
        category: null,
        isActive: true,
        batches: [{
          id: "1b5b9638-8930-4f16-8c4c-208c3a0bed96",
          medicineId,
          batchNumber: "E2E-FEFO-01",
          expiryDate: "2031-12-31T00:00:00.000Z",
          stockQuantity: 5,
          reorderLevel: 1,
          purchasePrice: 2,
          sellingPrice: 8,
          isActive: true,
          supplier: null,
        }],
      }],
    }),
  }))
  await page.route("**/api/v1/pharmacy/stock-movements**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) }))
  await page.route("**/api/v1/pharmacy/categories", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) }))
  await page.route("**/api/v1/pharmacy/overview", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        today: { date: "2026-06-15", sales: 0, transactions: 0 },
        lowStock: { count: 0, items: [] },
        expiring: { count: 0 },
        expired: { count: 0 },
        inventoryValue: { cost: 10, selling: 40, units: 5 },
        recentSales: [],
      },
    }),
  }))
  await page.route("**/api/v1/prescriptions?**", async (route) => {
    const status = new URL(route.request().url()).searchParams.get("status")
    const rows = status === "SIGNED"
      ? dispensed ? [] : [prescription]
      : status === "DISPENSED"
        ? dispensed ? [{ ...prescription, status: "DISPENSED" }] : []
        : []
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: rows }) })
  })
  await page.route(`**/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`, async (route) => {
    postedItems = route.request().postDataJSON().items
    dispensed = true
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          prescription: { id: prescriptionId, status: "DISPENSED" },
          sale: {
            id: "fd1aad0a-1e67-4c75-ad5d-fb270291e6bf",
            totalAmount: 24,
            cashier: { id: session.user.id, name: "System Administrator" },
            invoice: { id: "736891d2-63a9-4144-9fc9-8940b54bc54e", invoiceNumber: "PH-2026-000001" },
            items: [],
          },
        },
      }),
    })
  })

  await openDashboard(page, session, "/dashboard/pharmacy")
  await page.getByText("Prescriptions", { exact: true }).last().click()
  const row = page.getByRole("row").filter({ hasText: "E2E Pharmacy Medicine 10 mg" })
  await expect(row).toContainText("Ayesha Malik")
  await expect(row).toContainText("MR-2026-000001")
  await expect(row).toContainText("Dr. Ahmed Khan")
  await row.getByRole("button", { name: "Dispense" }).click()
  await page.getByLabel("Quantity for E2E Pharmacy Medicine 10 mg").fill("3")
  await page.getByRole("button", { name: "Dispense and create invoice" }).click()
  await expect(page.getByText("Invoice PH-2026-000001 created.", { exact: true })).toBeVisible()
  expect(postedItems).toEqual([{ prescriptionItemId, quantity: 3 }])
  await expect(page.getByRole("row").filter({ hasText: "E2E Pharmacy Medicine 10 mg" })).toContainText("DISPENSED")
  await expect(page.getByRole("row").filter({ hasText: "E2E Pharmacy Medicine 10 mg" }).getByRole("button", { name: "Dispense" })).toBeDisabled()
})
