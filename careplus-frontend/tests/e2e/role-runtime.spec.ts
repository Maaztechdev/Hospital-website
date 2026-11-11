import { test, expect } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4100/api/v1"

interface RoleSpec {
  role: string
  email: string
  password: string
  expectedLanding: string
  allowedPath: string
  allowedApi: string
  forbiddenApi: string
}

const ROLES_TO_TEST: RoleSpec[] = [
  {
    role: "PATHOLOGIST",
    email: "pathologist@careplus.local",
    password: "Staff@12345",
    expectedLanding: "/dashboard/lab",
    allowedPath: "/dashboard/lab/reports",
    allowedApi: `${apiBase}/lab/reports`,
    forbiddenApi: `${apiBase}/ultrasound/queue`,
  },
  {
    role: "RADIOLOGIST",
    email: "radiologist@careplus.local",
    password: "Staff@12345",
    expectedLanding: "/dashboard/ultrasound",
    allowedPath: "/dashboard/ultrasound/reports",
    allowedApi: `${apiBase}/ultrasound/queue`,
    forbiddenApi: `${apiBase}/lab/orders`,
  },
  {
    role: "ULTRASOUND_TECH",
    email: "ultrasoundtech@careplus.local",
    password: "Staff@12345",
    expectedLanding: "/dashboard/ultrasound",
    allowedPath: "/dashboard/ultrasound/overview",
    allowedApi: `${apiBase}/ultrasound/queue`,
    forbiddenApi: `${apiBase}/lab/orders`,
  },
  {
    role: "ULTRASOUND_TECHNICIAN",
    email: "ultrasoundtechnician@careplus.local",
    password: "Staff@12345",
    expectedLanding: "/dashboard/ultrasound",
    allowedPath: "/dashboard/ultrasound",
    allowedApi: `${apiBase}/ultrasound/queue`,
    forbiddenApi: `${apiBase}/billing/summary`,
  },
  {
    role: "BILLING_MANAGER",
    email: "billing-manager@careplus.local",
    password: "Billing@12345",
    expectedLanding: "/dashboard/billing",
    allowedPath: "/dashboard/billing",
    allowedApi: `${apiBase}/billing/summary`,
    forbiddenApi: `${apiBase}/pharmacy/overview`,
  },
]

test.describe("Runtime Role Authorization Tests (5 Specialized Roles)", () => {
  for (const spec of ROLES_TO_TEST) {
    test(`Role ${spec.role}: login, correct landing dashboard, allowed API 200, forbidden API 403`, async ({ page, request }) => {
      // 1. API Login
      const loginResp = await request.post(`${apiBase}/auth/login`, {
        data: { email: spec.email, password: spec.password },
      })
      expect(loginResp.ok(), `Login failed for ${spec.role}: ${await loginResp.text()}`).toBeTruthy()
      const loginJson = await loginResp.json()
      const { accessToken, _refreshToken, user } = loginJson.data

      expect(user.role).toBe(spec.role)

      // 2. Allowed API succeeds (200 OK)
      const allowedResp = await request.get(spec.allowedApi, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(allowedResp.status(), `Allowed API ${spec.allowedApi} should succeed for ${spec.role}`).toBe(200)

      // 3. Forbidden API returns 403 Forbidden
      const forbiddenResp = await request.get(spec.forbiddenApi, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      expect(forbiddenResp.status(), `Forbidden API ${spec.forbiddenApi} should return 403 for ${spec.role}`).toBe(403)

      // 4. UI Login & Landing Page Check
      await page.goto("/dashboard/login")
      await page.locator("#email").fill(spec.email)
      await page.locator("#password").fill(spec.password)
      await page.locator('button[type="submit"]').click()

      // Verify URL reaches the expected landing dashboard
      await page.waitForURL(`**${spec.expectedLanding}**`, { timeout: 15_000 })
      expect(page.url()).toContain(spec.expectedLanding)

      // Ensure root renders and no error boundary
      await page.locator("#root > *").first().waitFor({ state: "visible", timeout: 10_000 })
      const errorBoundaryLanding = await page.locator("role=alert >> text=This section could not load").count()
      expect(errorBoundaryLanding, `Error boundary should not be displayed on landing ${spec.expectedLanding}`).toBe(0)

      // Navigate to allowed page and verify clean render
      if (spec.allowedPath !== spec.expectedLanding) {
        await page.goto(spec.allowedPath, { waitUntil: "domcontentloaded" })
        await page.locator("#root > *").first().waitFor({ state: "visible", timeout: 10_000 })
        const errorBoundaryAllowed = await page.locator("role=alert >> text=This section could not load").count()
        expect(errorBoundaryAllowed, `Error boundary should not be displayed on ${spec.allowedPath}`).toBe(0)
      }
    })
  }
})
