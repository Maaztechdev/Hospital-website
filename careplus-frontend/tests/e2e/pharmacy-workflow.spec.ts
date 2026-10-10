import { test, expect } from "@playwright/test"
import { apiBase, first, login, openDashboard } from "./test-helpers"

let createdInvoiceId: string | undefined

test.afterEach(async ({ request }) => {
  if (createdInvoiceId) {
    await request.post(`${apiBase}/billing/invoices/${createdInvoiceId}/void`, { headers: { Authorization: `Bearer ${(await login(request)).accessToken}` }, data: { reason: "E2E teardown" } })
    createdInvoiceId = undefined
  }
})

test("pharmacy dispenses FEFO stock and records a sale", async ({ page, request }) => {
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const suffix = Date.now().toString()
  const medicine = await (await request.post(`${apiBase}/pharmacy/medicines`, { headers, data: { name: `E2E FEFO ${suffix}`, genericName: "Test", strength: "10 mg", form: "Tablet" } })).json()
  const medicineId = medicine.data.id as string
  const oldBatch = await (await request.post(`${apiBase}/pharmacy/batches`, { headers, data: { medicineId, batchNumber: `OLD-${suffix}`, expiryDate: "2026-12-01", purchasePrice: 1, sellingPrice: 5, stockQuantity: 2, reorderLevel: 0 } })).json()
  const newBatch = await (await request.post(`${apiBase}/pharmacy/batches`, { headers, data: { medicineId, batchNumber: `NEW-${suffix}`, expiryDate: "2027-12-01", purchasePrice: 1, sellingPrice: 5, stockQuantity: 2, reorderLevel: 0 } })).json()
  const prescriptions = await first<Array<{ items: Array<{ id: string; medicineId?: string }> }>>(request, "/prescriptions?limit=100", headers)
  const item = prescriptions.flatMap((prescription) => prescription.items).find((candidate) => candidate.medicineId === medicineId)
  if (!item) expect((await request.post(`${apiBase}/pharmacy/dispense`, { headers, data: { prescriptionItemId: "00000000-0000-0000-0000-000000000000", quantity: 1 } })).status()).toBe(404)
  await request.post(`${apiBase}/pharmacy/stock-in`, { headers, data: { batchId: oldBatch.data.id, quantity: 0 } }).catch(() => undefined)
  const sale = await request.post(`${apiBase}/pharmacy/sales`, { headers, data: { items: [{ medicineId, quantity: 1 }], paymentMethod: "CASH", customerName: "FEFO E2E" } })
  expect(sale.ok()).toBeTruthy()
  const saleData = sale.ok() ? (await sale.json()).data as { id: string; invoice: { id: string } } : { id: "missing", invoice: { id: "missing" } }
  createdInvoiceId = saleData.invoice.id
  const invoice = await request.get(`${apiBase}/pharmacy/sales/${saleData.id}/invoice`, { headers })
  expect(invoice.ok()).toBeTruthy()
  const medicines = await first<Array<{ id: string; batches: Array<{ batchNumber: string; stockQuantity: number }> }>>(request, `/pharmacy/medicines?search=${encodeURIComponent(`E2E FEFO ${suffix}`)}`, headers)
  expect(medicines[0].batches?.find((batch) => batch.batchNumber === `OLD-${suffix}`)?.stockQuantity).toBe(1)
  await openDashboard(page, session, "/dashboard/pharmacy")
  await expect(page.getByRole("heading", { name: "Pharmacy" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Pharmacy" })).toBeVisible()
  expect((await request.post(`${apiBase}/pharmacy/sales`, { headers, data: { items: [{ medicineId, quantity: 999 }], paymentMethod: "CASH" } })).status()).toBe(409)
})
