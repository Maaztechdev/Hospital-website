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
  const parameters = tests[0].parameters ?? []
  const numericIndex = parameters.findIndex((parameter: { resultType: string }) => parameter.resultType === "NUMERIC")
  const values = parameters.map((parameter: { id: string; resultType: string; ranges: Array<{ gender: string; low?: number | string | null; high?: number | string | null; criticalLow?: number | string | null; criticalHigh?: number | string | null }> }) => {
    if (parameter.resultType !== "NUMERIC") return { parameterId: parameter.id, value: "Observed" }
    const range = parameter.ranges.find((item) => item.gender === patients[0].gender) ?? parameter.ranges.find((item) => item.gender === "ANY")
    const low = range?.low == null ? null : Number(range.low)
    const high = range?.high == null ? null : Number(range.high)
    const criticalLow = range?.criticalLow == null ? null : Number(range.criticalLow)
    const criticalHigh = range?.criticalHigh == null ? null : Number(range.criticalHigh)
    const candidate = low != null && high != null ? (low + high) / 2
      : low != null ? Math.max(low, criticalLow == null ? low : criticalLow + 1)
        : high != null ? Math.min(high, criticalHigh == null ? high : criticalHigh - 1)
          : 5.4
    return { parameterId: parameter.id, value: String(candidate) }
  })
  const createResponse = await request.post(`${apiBase}/lab/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientId: patients[0].id, testId: tests[0].id, priority: "ROUTINE", sampleType: "Blood" },
  })
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy()
  const order = (await createResponse.json()).data
  expect(order.orderNumber).toMatch(/^LAB-\d{4}-\d{6}$/)

  const headers = { Authorization: `Bearer ${token}` }
  const statusResponse = await request.patch(`${apiBase}/lab/orders/${order.id}/sample-status`, { headers, data: { status: "SAMPLE_COLLECTED" } })
  expect(statusResponse.ok()).toBeTruthy()
  if (parameters.length) {
    const missingValueResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { parameters: values.slice(1) } })
    expect(missingValueResponse.status()).toBe(400)
    if (numericIndex >= 0) {
      const invalidValueResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { parameters: values.map((item: { parameterId: string; value: string }, index: number) => index === numericIndex ? { ...item, value: "not a number" } : item) } })
      expect(invalidValueResponse.status()).toBe(400)
    }
  }
  const resultPayload = parameters.length ? { parameters: values, technicianNotes: "Round trip test", reportRemarks: "Round trip printed remark" } : { resultValue: "5.4", unit: "mmol/L", referenceRange: "3.9 - 5.5", interpretation: "NORMAL" as const, technicianNotes: "Round trip test", reportRemarks: "Round trip printed remark" }
  const resultResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: resultPayload })
  expect(resultResponse.ok()).toBeTruthy()
  if (parameters.length) {
    const updatedFirstValue = parameters[0].resultType === "NUMERIC" ? String(Number(values[0].value) + 0.01) : "Observed v2"
    const secondValues = values.map((item: { parameterId: string; value: string }, index: number) => index === 0 ? { ...item, value: updatedFirstValue } : item)
    const secondVersion = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { parameters: secondValues, reportRemarks: "Version two" } })
    expect(secondVersion.ok(), await secondVersion.text()).toBeTruthy()
    const orderWithHistory = await apiGet(request, `/lab/orders/${order.id}`, token)
    expect(orderWithHistory.results).toHaveLength(2)
    expect(orderWithHistory.results.filter((item: { supersededById?: string | null }) => !item.supersededById)).toHaveLength(1)
  }
  const verifyResponse = await request.post(`${apiBase}/lab/orders/${order.id}/verify`, { headers })
  expect(verifyResponse.ok()).toBeTruthy()
  const verifiedOrder = (await verifyResponse.json()).data
  expect(verifiedOrder.verifiedBy).toBeTruthy()
  expect(verifiedOrder.verifiedAt).toBeTruthy()
  expect(verifiedOrder.verifier.name).toBeTruthy()
  const attachmentResponse = await request.post(`${apiBase}/lab/orders/${order.id}/attachments`, { headers, multipart: { file: { name: "lab-round-trip.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nE2E lab report") } } })
  expect(attachmentResponse.ok(), await attachmentResponse.text()).toBeTruthy()

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/admin")
  await expect(page).toHaveURL(/\/dashboard\/admin$/)
  await page.goto(`/dashboard/lab/${order.id}`)
  await expect(page.getByText(order.orderNumber, { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  await expect(page.getByText(new RegExp(`Verified by ${verifiedOrder.verifier.name}`))).toBeVisible()
  if (parameters.length) await expect(page.getByText(parameters[0].resultType === "NUMERIC" ? String(Number(values[0].value) + 0.01) : "Observed v2", { exact: true }).first()).toBeVisible()
  else await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  await expect(page.getByText("Report remarks: Version two", { exact: true })).toBeVisible()
  await expect(page.getByText("Attached report: lab-round-trip.pdf", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  if (!parameters.length) await expect(page.getByText("5.4", { exact: true })).toBeVisible()
})