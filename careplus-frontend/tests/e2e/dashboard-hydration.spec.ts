import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

test("dashboard hydrates real pharmacy state after reload", async ({ page, request }) => {
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const suffix = Date.now().toString()
  const medicineName = `Dashboard Hydration ${suffix}`

  const medicineResponse = await request.post(`${apiBase}/pharmacy/medicines`, {
    headers,
    data: { name: medicineName, genericName: "Hydration Test", strength: "10 mg", form: "Tablet" },
  })
  expect(medicineResponse.ok()).toBeTruthy()
  const medicine = (await medicineResponse.json()).data as { id: string }

  const batchResponse = await request.post(`${apiBase}/pharmacy/batches`, {
    headers,
    data: {
      medicineId: medicine.id,
      batchNumber: `DASH-${suffix}`,
      expiryDate: "2027-12-31",
      purchasePrice: 5,
      sellingPrice: 10,
      stockQuantity: 1,
      reorderLevel: 10,
    },
  })
  expect(batchResponse.ok()).toBeTruthy()

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/admin")
  await expect(page.getByRole("heading", { name: "Admin Overview" })).toBeVisible()
  await expect(page.getByText("Low Stock Medicines", { exact: true })).toBeVisible()

  const lowStockCard = page.getByText("Low Stock Medicines", { exact: true }).locator("xpath=../..")
  await expect(lowStockCard).toContainText(/[1-9][0-9]*/)

  await page.goto("/dashboard/pharmacy")
  await expect(page.getByRole("heading", { name: "Pharmacy" })).toBeVisible()
  await page.getByPlaceholder("Search medicine or generic name…").fill(medicineName)
  await expect(page.getByRole("table").getByText(medicineName, { exact: true })).toBeVisible()
  await page.reload()
  await page.getByPlaceholder("Search medicine or generic name…").fill(medicineName)
  await expect(page.getByRole("table").getByText(medicineName, { exact: true })).toBeVisible()
})
