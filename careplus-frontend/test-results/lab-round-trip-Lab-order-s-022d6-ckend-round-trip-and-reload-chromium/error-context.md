# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lab-round-trip.spec.ts >> Lab order survives the complete backend round trip and reload
- Location: tests\e2e\lab-round-trip.spec.ts:18:1

# Error details

```
Error: {"success":false,"data":null,"message":"Database request error","errors":null,"requestId":"359c9368-1f91-4ab6-ba22-13923cc3ac97"}

expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  1  | import { test, expect, type APIRequestContext } from "@playwright/test"
  2  | 
  3  | const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
  4  | const admin = { email: "admin@careplus.local", password: "Admin@12345" }
  5  | 
  6  | async function apiLogin(request: APIRequestContext) {
  7  |   const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  8  |   expect(response.ok()).toBeTruthy()
  9  |   return (await response.json()).data as { accessToken: string; refreshToken: string }
  10 | }
  11 | 
  12 | async function apiGet(request: APIRequestContext, path: string, token: string) {
  13 |   const response = await request.get(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  14 |   expect(response.ok()).toBeTruthy()
  15 |   return (await response.json()).data
  16 | }
  17 | 
  18 | test("Lab order survives the complete backend round trip and reload", async ({ page, request }) => {
  19 |   const session = await apiLogin(request)
  20 |   const token = session.accessToken
  21 |   const patients = await apiGet(request, "/patients?limit=1", token)
  22 |   const tests = await apiGet(request, "/lab/tests", token)
  23 |   const createResponse = await request.post(`${apiBase}/lab/orders`, {
  24 |     headers: { Authorization: `Bearer ${token}` },
  25 |     data: { patientId: patients[0].id, testId: tests[0].id, priority: "ROUTINE", sampleType: "Blood" },
  26 |   })
> 27 |   expect(createResponse.ok(), await createResponse.text()).toBeTruthy()
     |                                                            ^ Error: {"success":false,"data":null,"message":"Database request error","errors":null,"requestId":"359c9368-1f91-4ab6-ba22-13923cc3ac97"}
  28 |   const order = (await createResponse.json()).data
  29 |   expect(order.orderNumber).toMatch(/^LAB-\d{4}-\d{6}$/)
  30 | 
  31 |   const headers = { Authorization: `Bearer ${token}` }
  32 |   const statusResponse = await request.patch(`${apiBase}/lab/orders/${order.id}/sample-status`, { headers, data: { status: "SAMPLE_COLLECTED" } })
  33 |   expect(statusResponse.ok()).toBeTruthy()
  34 |   const resultResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { resultValue: "5.4", unit: "mmol/L", referenceRange: "3.9 - 5.5", interpretation: "NORMAL", technicianNotes: "Round trip test" } })
  35 |   expect(resultResponse.ok()).toBeTruthy()
  36 |   const verifyResponse = await request.post(`${apiBase}/lab/orders/${order.id}/verify`, { headers })
  37 |   expect(verifyResponse.ok()).toBeTruthy()
  38 |   const verifiedOrder = (await verifyResponse.json()).data
  39 |   expect(verifiedOrder.verifiedBy).toBeTruthy()
  40 |   expect(verifiedOrder.verifiedAt).toBeTruthy()
  41 |   expect(verifiedOrder.verifier.name).toBeTruthy()
  42 |   const attachmentResponse = await request.post(`${apiBase}/lab/orders/${order.id}/attachments`, { headers, multipart: { file: { name: "lab-round-trip.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nE2E lab report") } } })
  43 |   expect(attachmentResponse.ok(), await attachmentResponse.text()).toBeTruthy()
  44 | 
  45 |   await page.goto("/dashboard/login")
  46 |   await page.evaluate((tokens) => {
  47 |     sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
  48 |     sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  49 |   }, session)
  50 |   await page.goto("/dashboard/admin")
  51 |   await expect(page).toHaveURL(/\/dashboard\/admin$/)
  52 |   await page.goto(`/dashboard/lab/${order.id}`)
  53 |   await expect(page.getByText(order.orderNumber, { exact: true }).first()).toBeVisible()
  54 |   await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  55 |   await expect(page.getByText(new RegExp(`Verified by ${verifiedOrder.verifier.name}`))).toBeVisible()
  56 |   await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  57 |   await expect(page.getByText("Attached report: lab-round-trip.pdf", { exact: true })).toBeVisible()
  58 |   await page.reload()
  59 |   await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  60 |   await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  61 | })
```