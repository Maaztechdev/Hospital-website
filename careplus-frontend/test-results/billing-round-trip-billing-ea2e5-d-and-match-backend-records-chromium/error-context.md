# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: billing-round-trip.spec.ts >> billing mutations persist after reload and match backend records
- Location: tests\e2e\billing-round-trip.spec.ts:12:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'New Invoice' })
    - locator resolved to <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 cursor-pointer bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] shadow-care hover:shadow-care-hover hover:-translate-y-0.5 h-9 px-4 text-[13px]">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - complementary [ref=f1e4]:
    - generic [ref=f1e9]:
      - paragraph [ref=f1e10]: Khalida Medicare
      - paragraph [ref=f1e11]: Hospital
    - navigation [ref=f1e12]:
      - link "Overview" [ref=f1e13] [cursor=pointer]:
        - /url: /dashboard/admin
      - link "Patients" [ref=f1e20] [cursor=pointer]:
        - /url: /dashboard/patients
      - link "Appointments" [ref=f1e27] [cursor=pointer]:
        - /url: /dashboard/appointments
      - link "OPD Queue" [ref=f1e33] [cursor=pointer]:
        - /url: /dashboard/queue
      - link "Doctor Panel" [ref=f1e38] [cursor=pointer]:
        - /url: /dashboard/doctor
      - link "Lab" [ref=f1e44] [cursor=pointer]:
        - /url: /dashboard/lab
      - link "Ultrasound" [ref=f1e48] [cursor=pointer]:
        - /url: /dashboard/ultrasound
      - link "Pharmacy" [ref=f1e55] [cursor=pointer]:
        - /url: /dashboard/pharmacy
      - link "Billing" [ref=f1e60] [cursor=pointer]:
        - /url: /dashboard/billing
      - link "Ward Board" [ref=f1e65] [cursor=pointer]:
        - /url: /dashboard/ward
      - link "Nurse Panel" [ref=f1e70] [cursor=pointer]:
        - /url: /dashboard/nurse
      - link "Operation Theatre" [ref=f1e75] [cursor=pointer]:
        - /url: /dashboard/ot
      - link "Reports" [ref=f1e84] [cursor=pointer]:
        - /url: /dashboard/reports
      - link "Audit Logs" [ref=f1e88] [cursor=pointer]:
        - /url: /dashboard/audit-logs
      - link "Settings" [ref=f1e93] [cursor=pointer]:
        - /url: /dashboard/settings
      - link "Users" [ref=f1e98] [cursor=pointer]:
        - /url: /dashboard/users
      - link "Backup & Restore" [ref=f1e105] [cursor=pointer]:
        - /url: /dashboard/admin/backup
    - button "Collapse sidebar" [ref=f1e113]: Collapse
  - generic [ref=f1e117]:
    - banner [ref=f1e118]:
      - paragraph [ref=f1e120]: Khalida Medicare Hospital
      - textbox "Search patients, doctors, beds…" [ref=f1e122]
      - generic [ref=f1e123]:
        - button "Notifications" [ref=f1e125]
        - button "Help" [ref=f1e129]
        - button "Administrator" [ref=f1e134]
    - main [ref=f1e144]:
      - generic [ref=f1e145]:
        - navigation "Breadcrumb" [ref=f1e146]:
          - link "Dashboard" [ref=f1e148] [cursor=pointer]:
            - /url: /dashboard
          - generic [ref=f1e149]: Billing
        - generic [ref=f1e153]:
          - generic [ref=f1e154]:
            - heading "Billing" [level=1] [ref=f1e155]
            - button "New Invoice" [ref=f1e157] [cursor=pointer]
          - generic [ref=f1e159]:
            - generic [ref=f1e160]:
              - generic [ref=f1e161]: Today's Revenue
              - generic [ref=f1e167]: Rs. 0
            - generic [ref=f1e169]:
              - generic [ref=f1e170]: Paid Invoices
              - generic [ref=f1e176]: "0"
            - generic [ref=f1e178]:
              - generic [ref=f1e179]: Partial
              - generic [ref=f1e184]: "0"
            - generic [ref=f1e186]:
              - generic [ref=f1e187]: Unpaid
              - generic [ref=f1e192]: "0"
            - generic [ref=f1e194]:
              - generic [ref=f1e195]: Ward Charges
              - generic [ref=f1e201]: Rs. 0
            - generic [ref=f1e203]:
              - generic [ref=f1e204]: Lab Revenue
              - generic [ref=f1e209]: Rs. 0
            - generic [ref=f1e211]:
              - generic [ref=f1e212]: Pharmacy Revenue
              - generic [ref=f1e218]: Rs. 0
          - generic [ref=f1e220]:
            - heading "Monthly Revenue Report" [level=3] [ref=f1e222]
            - img "Bar chart" [ref=f1e224]:
              - generic [ref=f1e225]: Feb
              - generic [ref=f1e228]: Mar
              - generic [ref=f1e231]: Apr
              - generic [ref=f1e234]: May
              - generic [ref=f1e237]: Jun
              - generic [ref=f1e240]: Jul
              - generic [ref=f1e243]: Aug
          - generic [ref=f1e246]:
            - textbox "Search invoice, patient, or MR number…" [ref=f1e248]
            - combobox "Status" [ref=f1e250]:
              - option "All statuses" [selected]
              - option "Paid"
              - option "Partial"
              - option "Unpaid"
              - option "Void"
          - generic [ref=f1e251]:
            - heading "No invoices found" [level=3] [ref=f1e256]
            - paragraph [ref=f1e257]: Records will appear here once available.
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
  12 | test("billing mutations persist after reload and match backend records", async ({ page, request }) => {
  13 |   const session = await apiLogin(request)
  14 |   const headers = { Authorization: `Bearer ${session.accessToken}` }
  15 |   const patientsResponse = await request.get(`${apiBase}/patients?limit=1`, { headers })
  16 |   expect(patientsResponse.ok()).toBeTruthy()
  17 |   const patient = (await patientsResponse.json()).data[0] as { id: string; mrNumber: string }
  18 | 
  19 |   await page.goto("/dashboard/login")
  20 |   await page.evaluate((tokens) => {
  21 |     sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
  22 |     sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  23 |   }, session)
  24 |   await page.goto("/dashboard/billing")
  25 |   await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible()
  26 | 
> 27 |   await page.getByRole("button", { name: "New Invoice" }).click()
     |                                                           ^ Error: locator.click: Test timeout of 30000ms exceeded.
  28 |   const createDialog = page.getByRole("dialog")
  29 |   await createDialog.locator("input").nth(0).fill(patient.mrNumber)
  30 |   await createDialog.locator("input").nth(1).fill("Round trip consultation")
  31 |   await createDialog.locator("input").nth(3).fill("100")
  32 |   await createDialog.getByRole("button", { name: "Save Invoice" }).click()
  33 |   await expect(page).toHaveURL(/\/dashboard\/billing\/[0-9a-f-]+$/)
  34 | 
  35 |   const invoiceId = page.url().split("/").pop()!
  36 |   const createdResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  37 |   expect(createdResponse.ok()).toBeTruthy()
  38 |   const created = (await createdResponse.json()).data
  39 |   expect(created.status).toBe("FINALIZED")
  40 |   expect(Number(created.grandTotal)).toBe(100)
  41 | 
  42 |   await page.getByRole("button", { name: "Receive Payment" }).click()
  43 |   const paymentDialog = page.getByRole("dialog")
  44 |   await paymentDialog.locator("input").nth(0).fill("40")
  45 |   await paymentDialog.getByRole("button", { name: "Confirm Payment" }).click()
  46 |   await expect(page.getByText("Payment received", { exact: true })).toBeVisible()
  47 | 
  48 |   const partialResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  49 |   const partial = (await partialResponse.json()).data
  50 |   expect(partial.status).toBe("PARTIAL")
  51 |   expect(Number(partial.paidAmount)).toBe(40)
  52 |   expect(partial.payments).toHaveLength(1)
  53 | 
  54 |   await page.getByRole("button", { name: "Void Invoice" }).click()
  55 |   const voidDialog = page.getByRole("dialog")
  56 |   await voidDialog.locator("textarea").fill("Round trip test cleanup")
  57 |   await voidDialog.getByRole("button", { name: "Void Invoice" }).click()
  58 |   await expect(page.getByText("Invoice voided", { exact: true })).toBeVisible()
  59 | 
  60 |   const voidedResponse = await request.get(`${apiBase}/billing/invoices/${invoiceId}`, { headers })
  61 |   const voided = (await voidedResponse.json()).data
  62 |   expect(voided.status).toBe("VOID")
  63 |   expect(Number(voided.paidAmount)).toBe(40)
  64 |   expect(voided.voidReason).toBe("Round trip test cleanup")
  65 |   expect(voided.payments).toHaveLength(0)
  66 | 
  67 |   await page.reload()
  68 |   await expect(page.getByText("Void", { exact: true }).first()).toBeVisible()
  69 |   await expect(page.getByText(/Reason: Round trip test cleanup/)).toBeVisible()
  70 |   await expect(page.getByText("No payments recorded yet.", { exact: true })).toBeVisible()
  71 | })
```