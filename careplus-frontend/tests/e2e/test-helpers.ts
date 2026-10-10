import { expect, type APIRequestContext, type Page } from "@playwright/test"

export const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
export const admin = { email: "admin@careplus.local", password: "Admin@12345" }

export async function login(request: APIRequestContext, credentials = admin) {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string; user: { id: string; role: string } }
}

export async function openDashboard(page: Page, session: { accessToken: string; refreshToken: string }, path: string) {
  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto(path)
}

export async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as T
}

export async function first<T>(request: APIRequestContext, path: string, headers: Record<string, string>): Promise<T> {
  return json<T>(await request.get(`${apiBase}${path}`, { headers }))
}
