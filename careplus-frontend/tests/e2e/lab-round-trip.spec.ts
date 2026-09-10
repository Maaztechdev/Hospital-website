import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

async function apiGet(request: APIRequestContext, path: string, token: string) {
  const response = await request.get(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data
}

test("Lab order survives the complete backend round trip and reload", async ({ page, request }) => {
  const session = await apiLogin(request)
  const token = session.accessToken
  const patients = await apiGet(request, "/patients?limit=1", token)
  const tests = await apiGet(request, "/lab/tests", token)
  const createResponse = await request.post(`${apiBase}/lab/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientId: patients[0].id, testId: tests[0].id, priority: "ROUTINE", sampleType: "Blood" },
  })
  expect(createResponse.ok()).toBeTruthy()
  const order = (await createResponse.json()).data

  const headers = { Authorization: `Bearer ${token}` }
  const statusResponse = await request.patch(`${apiBase}/lab/orders/${order.id}/sample-status`, { headers, data: { status: "SAMPLE_COLLECTED" } })
  expect(statusResponse.ok()).toBeTruthy()
  const resultResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { resultValue: "5.4", unit: "mmol/L", referenceRange: "3.9 - 5.5", interpretation: "NORMAL", technicianNotes: "Round trip test" } })
  expect(resultResponse.ok()).toBeTruthy()
  const verifyResponse = await request.post(`${apiBase}/lab/orders/${order.id}/verify`, { headers })
  expect(verifyResponse.ok()).toBeTruthy()
  const attachmentResponse = await request.post(`${apiBase}/lab/orders/${order.id}/attachments`, { headers, data: { fileUrl: "https://example.com/lab-round-trip.pdf", fileType: "application/pdf" } })
  expect(attachmentResponse.ok()).toBeTruthy()

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/admin")
  await expect(page).toHaveURL(/\/dashboard\/admin$/)
  await page.goto(`/dashboard/lab/${order.id}`)
  await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  await expect(page.getByText("Attached report: lab-round-trip.pdf", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  await expect(page.getByText("5.4", { exact: true })).toBeVisible()
})