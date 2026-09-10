# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lab-round-trip.spec.ts >> Lab order survives the complete backend round trip and reload
- Location: tests\e2e\lab-round-trip.spec.ts:18:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Verified', { exact: true }).last()
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Verified', { exact: true }).last()
  - Protocol error (Runtime.callFunctionOn): Internal server error, session closed.

```

```yaml
- text: Loading dashboard…
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
  27 |   expect(createResponse.ok()).toBeTruthy()
  28 |   const order = (await createResponse.json()).data
  29 | 
  30 |   const headers = { Authorization: `Bearer ${token}` }
  31 |   const statusResponse = await request.patch(`${apiBase}/lab/orders/${order.id}/sample-status`, { headers, data: { status: "SAMPLE_COLLECTED" } })
  32 |   expect(statusResponse.ok()).toBeTruthy()
  33 |   const resultResponse = await request.post(`${apiBase}/lab/orders/${order.id}/results`, { headers, data: { resultValue: "5.4", unit: "mmol/L", referenceRange: "3.9 - 5.5", interpretation: "NORMAL", technicianNotes: "Round trip test" } })
  34 |   expect(resultResponse.ok()).toBeTruthy()
  35 |   const verifyResponse = await request.post(`${apiBase}/lab/orders/${order.id}/verify`, { headers })
  36 |   expect(verifyResponse.ok()).toBeTruthy()
  37 |   const attachmentResponse = await request.post(`${apiBase}/lab/orders/${order.id}/attachments`, { headers, data: { fileUrl: "https://example.com/lab-round-trip.pdf", fileType: "application/pdf" } })
  38 |   expect(attachmentResponse.ok()).toBeTruthy()
  39 | 
  40 |   await page.goto("/dashboard/login")
  41 |   await page.evaluate((tokens) => {
  42 |     sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
  43 |     sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  44 |   }, session)
  45 |   await page.goto("/dashboard/admin")
  46 |   await expect(page).toHaveURL(/\/dashboard\/admin$/)
  47 |   await page.goto(`/dashboard/lab/${order.id}`)
> 48 |   await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  49 |   await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  50 |   await expect(page.getByText("Attached report: lab-round-trip.pdf", { exact: true })).toBeVisible()
  51 |   await page.reload()
  52 |   await expect(page.getByText("Verified", { exact: true }).last()).toBeVisible()
  53 |   await expect(page.getByText("5.4", { exact: true })).toBeVisible()
  54 | })
```