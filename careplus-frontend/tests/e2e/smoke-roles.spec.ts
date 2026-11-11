import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4100/api/v1"

const ROLES = [
  {
    role: "Billing Manager",
    email: "billing-manager@careplus.local",
    password: "Billing@12345",
    pages: [
      { label: "All billing", path: "/dashboard/billing" },
      { label: "Patients", path: "/dashboard/patients" },
      { label: "Ward Board", path: "/dashboard/ward" },
      { label: "Lab billing", path: "/dashboard/lab?section=billing" },
      { label: "Pharmacy billing", path: "/dashboard/pharmacy?section=billing" },
      { label: "Ultrasound billing", path: "/dashboard/ultrasound?section=billing" },
    ],
  },
  {
    role: "Admin",
    email: "admin@careplus.local",
    password: "Admin@12345",
    pages: [
      { label: "Overview", path: "/dashboard/admin" },
      { label: "Patients", path: "/dashboard/patients" },
      { label: "Appointments", path: "/dashboard/appointments" },
      { label: "OPD Queue", path: "/dashboard/queue" },
      { label: "Doctor Panel", path: "/dashboard/doctor" },
      { label: "Lab", path: "/dashboard/lab" },
      { label: "Lab Reports", path: "/dashboard/lab/reports" },
      { label: "Lab Credit Ledger", path: "/dashboard/lab/ledger" },
      { label: "Lab Test Catalog", path: "/dashboard/lab/catalog" },
      { label: "Lab Inventory", path: "/dashboard/lab/inventory" },
      { label: "Lab Settings", path: "/dashboard/lab/settings" },
      { label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview" },
      { label: "Ultrasound Queue", path: "/dashboard/ultrasound" },
      { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports" },
      { label: "Ultrasound Audit Trail", path: "/dashboard/ultrasound/audit-trail" },
      { label: "Pharmacy", path: "/dashboard/pharmacy" },
      { label: "Pharmacy Settings", path: "/dashboard/pharmacy/settings" },
      { label: "Invoices", path: "/dashboard/pharmacy/invoices" },
      { label: "Pharmacy Reports", path: "/dashboard/pharmacy/reports" },
      { label: "Khata", path: "/dashboard/pharmacy/khata" },
      { label: "Discount Audit", path: "/dashboard/pharmacy/discount-audit" },
      { label: "Voided Sales & Returns", path: "/dashboard/pharmacy/sale-adjustments" },
      { label: "Billing", path: "/dashboard/billing" },
      { label: "Ward Board", path: "/dashboard/ward" },
      { label: "Nurse Panel", path: "/dashboard/nurse" },
      { label: "Operation Theatre", path: "/dashboard/ot" },
      { label: "Reports", path: "/dashboard/reports" },
      { label: "Audit Logs", path: "/dashboard/audit-logs" },
      { label: "Settings", path: "/dashboard/settings" },
      { label: "Users", path: "/dashboard/users" },
      { label: "Backup & Restore", path: "/dashboard/admin/backup" },
    ],
  },
  {
    role: "Doctor",
    email: "dr.ahmed@careplus.local",
    password: "Doctor@12345",
    pages: [
      { label: "My Dashboard", path: "/dashboard/doctor" },
      { label: "Appointments", path: "/dashboard/appointments" },
      { label: "Patients", path: "/dashboard/patients" },
      { label: "Ward Board", path: "/dashboard/ward" },
      { label: "Operation Theatre", path: "/dashboard/ot" },
      { label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview" },
      { label: "Ultrasound Queue", path: "/dashboard/ultrasound" },
      { label: "Ultrasound Reports", path: "/dashboard/ultrasound/reports" },
    ],
  },
  {
    role: "Pharmacist",
    email: "pharmacist@careplus.local",
    password: "Staff@12345",
    pages: [
      { label: "Pharmacy", path: "/dashboard/pharmacy" },
      { label: "Invoices", path: "/dashboard/pharmacy/invoices" },
      { label: "Pharmacy Reports", path: "/dashboard/pharmacy/reports" },
      { label: "Khata", path: "/dashboard/pharmacy/khata" },
      { label: "Discount Audit", path: "/dashboard/pharmacy/discount-audit" },
      { label: "Voided Sales & Returns", path: "/dashboard/pharmacy/sale-adjustments" },
      { label: "Patients", path: "/dashboard/patients" },
    ],
  },
  {
    role: "Nurse",
    email: "nurse@careplus.local",
    password: "Staff@12345",
    pages: [
      { label: "Nurse Panel", path: "/dashboard/nurse" },
      { label: "Ward Board", path: "/dashboard/ward" },
      { label: "Patients", path: "/dashboard/patients" },
    ],
  },
  {
    role: "Receptionist",
    email: "reception@careplus.local",
    password: "Staff@12345",
    pages: [
      { label: "Patients", path: "/dashboard/patients" },
      { label: "Appointments", path: "/dashboard/appointments" },
      { label: "OPD Queue", path: "/dashboard/queue" },
      { label: "Billing", path: "/dashboard/billing" },
      { label: "Ward Board", path: "/dashboard/ward" },
      { label: "Ultrasound Overview", path: "/dashboard/ultrasound/overview" },
      { label: "Ultrasound Queue", path: "/dashboard/ultrasound" },
    ],
  },
  {
    role: "Lab tech",
    email: "labtech@careplus.local",
    password: "Staff@12345",
    pages: [
      { label: "Lab Dashboard", path: "/dashboard/lab" },
      { label: "Lab Reports", path: "/dashboard/lab/reports" },
      { label: "Test Catalog", path: "/dashboard/lab/catalog" },
      { label: "Lab Inventory", path: "/dashboard/lab/inventory" },
      { label: "Patients", path: "/dashboard/patients" },
    ],
  },
]

interface PageResult {
  role: string
  label: string
  path: string
  status: "OK" | "FAIL"
  notes: string[]
  errorBoundary: boolean
  whiteScreen: boolean
  consoleErrors: string[]
  failingCalls: Array<{ url: string; status: number }>
}

test.describe("Multi-role Smoke Test", () => {
  test.setTimeout(420_000)

  test("verify all sidebar pages for all 7 roles", async ({ browser, request }) => {
    const allResults: PageResult[] = []

    for (const roleDef of ROLES) {
      console.log(`\n=== Testing role: ${roleDef.role} (${roleDef.email}) ===`)

      const context = await browser.newContext()
      const page = await context.newPage()

      // 1. Login via API to get tokens
      const loginResp = await request.post(`${apiBase}/auth/login`, {
        data: { email: roleDef.email, password: roleDef.password },
      })
      expect(loginResp.ok(), `Login failed for ${roleDef.role}: ${await loginResp.text()}`).toBeTruthy()
      const { accessToken, refreshToken } = (await loginResp.json()).data

      // 2. Clear state and inject tokens
      await page.goto("/dashboard/login")
      await page.evaluate(({ token, refresh }) => {
        sessionStorage.clear()
        localStorage.clear()
        sessionStorage.setItem("careplus.accessToken", token)
        sessionStorage.setItem("careplus.refreshToken", refresh)
      }, { token: accessToken, refresh: refreshToken })

      // 3. Test each page for this role
      for (const pageDef of roleDef.pages) {
        const consoleErrors: string[] = []
        const pageErrors: string[] = []
        const failingCalls: Array<{ url: string; status: number }> = []

        const onConsole = (msg: any) => {
          if (msg.type() === "error") {
            const text = msg.text()
            // Ignore benign websocket or favicon errors if any
            if (!text.includes("favicon") && !text.includes("WebSocket")) {
              consoleErrors.push(text)
            }
          }
        }
        const onPageError = (err: Error) => {
          pageErrors.push(err.message || String(err))
        }
        const onResponse = (resp: any) => {
          const status = resp.status()
          const url = resp.url()
          if (status >= 400 && !url.includes("favicon")) {
            failingCalls.push({ url, status })
          }
        }

        page.on("console", onConsole)
        page.on("pageerror", onPageError)
        page.on("response", onResponse)

        try {
          try {
            await page.goto(pageDef.path, { waitUntil: "domcontentloaded" })
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("ERR_INSUFFICIENT_RESOURCES")) {
              await new Promise((resolve) => setTimeout(resolve, 1_000))
              await page.goto(pageDef.path, { waitUntil: "domcontentloaded" })
            } else {
              throw err
            }
          }
          let rootVisible = true
          try {
            await page.locator("#root > *").first().waitFor({ state: "visible", timeout: 10_000 })
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "TimeoutError") throw error
            rootVisible = false
          }
          await page.waitForTimeout(500)

          // Check for error boundary
          const errorBoundaryAlert = await page.locator("role=alert >> text=This section could not load").count()
          const hasErrorBoundary = errorBoundaryAlert > 0

          // Check for white screen (empty body or root)
          const rootChildrenCount = await page.locator("#root > *").count()
          const isWhiteScreen = !rootVisible || rootChildrenCount === 0

          const notes: string[] = []
          if (hasErrorBoundary) notes.push("Error boundary triggered")
          if (isWhiteScreen) notes.push("White screen (empty root)")
          if (pageErrors.length > 0) notes.push(`Page error: ${pageErrors.join("; ")}`)
          if (consoleErrors.length > 0) notes.push(`Console errors: ${consoleErrors.length} (${consoleErrors[0]?.slice(0, 100)})`)
          if (failingCalls.length > 0) {
            notes.push(`Failing calls (${failingCalls.length}): ${failingCalls.map(c => `${c.status} ${c.url.split("/").pop()}`).join(", ")}`)
          }

          // Allow-list of genuinely expected 4xx/5xx responses, documented with explicit reasons:
          // Currently, every sidebar page shown to a role is aligned with backend guards, so zero
          // 401/403/404/5xx calls are expected or tolerated. Any unexpected 4xx/5xx fails the test.
          const allowList: Array<{ urlPattern: RegExp; status: number; reason: string }> = [
            // Format: { urlPattern: /\/api\/v1\/.../, status: 403, reason: "Explicit reason why this status is normal/expected" }
          ]

          const unexpectedFailingCalls = failingCalls.filter((call) => {
            const isTolerated = allowList.some((entry) => entry.urlPattern.test(call.url) && entry.status === call.status)
            return !isTolerated
          })

          const isFail = hasErrorBoundary || isWhiteScreen || pageErrors.length > 0 || unexpectedFailingCalls.length > 0
          const status: "OK" | "FAIL" = isFail ? "FAIL" : (notes.length > 0 ? "OK" : "OK")

          const result: PageResult = {
            role: roleDef.role,
            label: pageDef.label,
            path: pageDef.path,
            status,
            notes,
            errorBoundary: hasErrorBoundary,
            whiteScreen: isWhiteScreen,
            consoleErrors: [...consoleErrors, ...pageErrors],
            failingCalls,
          }
          allResults.push(result)
          console.log(`[${status}] ${roleDef.role} -> ${pageDef.label} (${pageDef.path}) ${notes.length ? `[${notes.join("; ")}]` : ""}`)
        } finally {
          page.off("console", onConsole)
          page.off("pageerror", onPageError)
          page.off("response", onResponse)
        }
      }

      await context.close()
    }

    // Save full JSON report
    const outputPath = path.resolve(process.cwd(), "../scratch/smoke_results.json")
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2), "utf8")
    console.log(`\nSmoke results written to ${outputPath}`)
    console.log(`Total pages tested: ${allResults.length}`)
    console.log(`Total PASSED: ${allResults.filter(r => r.status === "OK" && r.notes.length === 0).length}`)
    console.log(`Total OK with warnings: ${allResults.filter(r => r.status === "OK" && r.notes.length > 0).length}`)
    console.log(`Total FAILED: ${allResults.filter(r => r.status === "FAIL").length}`)

    // Fail test if any page has error boundary or white screen
    const failures = allResults.filter(r => r.status === "FAIL")
    expect(failures.length, `Pages failed: ${JSON.stringify(failures, null, 2)}`).toBe(0)
  })
})
