import { test, expect, type Page } from "@playwright/test"

const admin = { email: "admin@careplus.local", password: "Admin@12345" }
const receptionist = { email: "reception@careplus.local", password: "Staff@12345" }

async function signIn(page: Page, credentials: typeof admin) {
  await page.getByLabel("Email").fill(credentials.email)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: "Sign in to dashboard" }).click()
}

test("switching sessions does not reuse the previous role or produce 401s in the new session", async ({ page }) => {
  const unauthorizedResponses: string[] = []
  page.on("response", (response) => {
    if (response.status() === 401) unauthorizedResponses.push(response.url())
  })

  await page.goto("/dashboard/login")
  await signIn(page, admin)
  await expect(page).toHaveURL(/\/dashboard\/admin$/)
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "Patients" }).click()
  await expect(page).toHaveURL(/\/dashboard\/patients$/)
  await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible()

  await page.getByRole("button", { name: /Administrator/ }).click()
  await page.getByRole("button", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/dashboard\/login$/)
  unauthorizedResponses.length = 0

  await signIn(page, receptionist)
  await expect(page).toHaveURL(/\/dashboard\/appointments(?:\?.*)?$/)
  await expect(page.getByText("Receptionist", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Appointments", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0)
  expect(unauthorizedResponses, `401 responses: ${unauthorizedResponses.join(", ")}`).toEqual([])
})

test("session warning is single, refresh dismisses it, and inactivity starts a fresh warning period", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__CAREPLUS_SESSION_CONFIG__", {
      configurable: false,
      value: { warningLeadMs: 5_000, inactivityTimeoutMs: 2_000 },
    })
  })
  await page.goto("/dashboard/login")
  await signIn(page, admin)

  const warning = page.getByText("Your session will expire soon. Stay signed in to continue working.", { exact: true })
  await expect(warning).toBeVisible({ timeout: 10_000 })
  await expect(warning).toHaveCount(1)
  await page.getByRole("button", { name: "Stay signed in" }).click()
  await expect(warning).toHaveCount(0)
  await expect(warning).toHaveCount(0, { timeout: 1_000 })
  await expect(warning).toBeVisible({ timeout: 10_000 })
  await expect(warning).toHaveCount(1)
})

test("parallel unauthorized API requests share one refresh and retry successfully", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    Object.defineProperty(window, "__refreshCallCount", { configurable: false, writable: true, value: 0 })
    Object.defineProperty(window, "__authMe401Count", { configurable: false, writable: true, value: 0 })
    window.fetch = (input, init) => {
      const url = String(input)
      if (url.includes("/auth/me") && (window as Window & { __authMe401Count: number }).__authMe401Count < 2) {
        const current = (window as Window & { __authMe401Count: number }).__authMe401Count
        ;(window as Window & { __authMe401Count: number }).__authMe401Count = current + 1
        return Promise.resolve(new Response(JSON.stringify({ success: false, data: null, message: "Invalid or expired access token", errors: null }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }))
      }
      if (url.includes("/auth/refresh")) {
        const current = (window as Window & { __refreshCallCount: number }).__refreshCallCount
        ;(window as Window & { __refreshCallCount: number }).__refreshCallCount = current + 1
      }
      return originalFetch(input, init)
    }
  })
  await page.goto("/dashboard/login")
  await signIn(page, admin)
  await expect(page).toHaveURL(/\/dashboard\/admin$/)

  const results = await page.evaluate(async () => {
    const moduleUrl = new URL("/src/lib/api.ts", window.location.origin).href
    const { apiRequest } = await import(/* @vite-ignore */ moduleUrl) as typeof import("../../src/lib/api")
    const users = await Promise.all([apiRequest("/auth/me"), apiRequest("/auth/me")])
    const refreshCalls = (window as Window & { __refreshCallCount: number }).__refreshCallCount
    const unauthorizedCalls = (window as Window & { __authMe401Count: number }).__authMe401Count
    return { users, refreshCalls, unauthorizedCalls }
  })
  expect(results.users).toHaveLength(2)
  expect(results.unauthorizedCalls).toBe(2)
  expect(results.refreshCalls).toBe(1)
})