import fs from "fs"
import path from "path"
import { expect, type APIRequestContext, type Page } from "@playwright/test"

export const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
export const admin = { email: "admin@careplus.local", password: "Admin@12345" }

export async function login(request: APIRequestContext, credentials = admin) {
  let response
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await request.post(`${apiBase}/auth/login`, { data: credentials })
      if (response.ok()) break
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  expect(response?.ok()).toBeTruthy()
  return (await response!.json()).data as { accessToken: string; refreshToken: string; user: { id: string; role: string } }
}

export async function openDashboard(page: Page, session: { accessToken: string; refreshToken: string }, path: string) {
  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto(path)
}

export async function safeGet(request: APIRequestContext, url: string, options?: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request.get(url, options)
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`Failed to GET ${url}`)
}

export async function json<T>(responsePromise: Promise<Awaited<ReturnType<APIRequestContext["get"]>>> | Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const response = await responsePromise
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as T
}

export async function first<T>(request: APIRequestContext, path: string, headers: Record<string, string>): Promise<T> {
  return json<T>(safeGet(request, `${apiBase}${path}`, { headers }))
}

export function getTodayDateString(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  return `${value("year")}-${value("month")}-${value("day")}`
}

export async function ensureAvailableBeds(
  request: APIRequestContext,
  headers: Record<string, string>,
  minAvailable = 2
): Promise<Array<{ id: string; bedNumber: string; status: string }>> {
  // Hard safety guard: ensureAvailableBeds MUST only run in safe test environments
  let dbUrl = process.env.DATABASE_URL ?? ""
  if (!dbUrl) {
    try {
      const candidates = [
        path.resolve(process.cwd(), "../careplus-backend/.env.test"),
        path.resolve(process.cwd(), "careplus-backend/.env.test"),
        path.resolve(process.cwd(), ".env.test"),
      ]
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          const match = fs.readFileSync(c, "utf-8").match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m)
          if (match) {
            dbUrl = match[1]
            break
          }
        }
      }
    } catch {
      // ignore
    }
  }
  const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/)
  const dbName = dbMatch ? dbMatch[1] : ""
  const isTestDb = Boolean(dbName && dbName.endsWith("_test"))
  const isLocalTestPort = /127\.0\.0\.1:(4000|4100|5180)|localhost:(4000|4100|5180)/.test(apiBase)

  if (!isTestDb || !isLocalTestPort) {
    throw new Error(
      `CRITICAL TEST HARNESS SAFETY ABORT: ensureAvailableBeds requires BOTH a test database ending in "_test" AND a local test API port (4000, 4100, 5180)! (DATABASE_URL="${dbName}", apiBase="${apiBase}")`
    )
  }

  const fetchBeds = async () => {
    const res = await request.get(`${apiBase}/wards/beds/availability`, { headers })
    if (!res.ok()) return []
    return (await res.json()).data as Array<{ id: string; bedNumber: string; status: string }>
  }

  let beds = await fetchBeds()
  let available = beds.filter((b) => b.status === "AVAILABLE")
  if (available.length >= minAvailable) return available

  // 1. Mark any beds in CLEANING as AVAILABLE
  const cleaning = beds.filter((b) => b.status === "CLEANING")
  for (const bed of cleaning) {
    if (available.length >= minAvailable) break
    const res = await request.patch(`${apiBase}/wards/beds/${bed.id}/status`, {
      headers,
      data: { status: "AVAILABLE" },
    })
    if (res.ok()) {
      available.push({ ...bed, status: "AVAILABLE" })
    }
  }

  if (available.length >= minAvailable) return available

  // 2. If still needed, discharge active admissions using admin override
  const admissionsRes = await request.get(`${apiBase}/wards/admissions?limit=50&status=ACTIVE`, { headers })
  if (admissionsRes.ok()) {
    const admissions = (await admissionsRes.json()).data as Array<{ id: string; bedId: string }>
    for (const adm of admissions) {
      if (available.length >= minAvailable) break
      await request.post(`${apiBase}/wards/admissions/${adm.id}/discharge`, {
        headers,
        data: {
          diagnosis: "Automated test bed release",
          conditionAtDischarge: "Stable",
          instructions: "Automated cleanup",
          confirmUnpaidBalance: true,
          overrideReason: "E2E bed setup isolation",
        },
      })
      await request.patch(`${apiBase}/wards/beds/${adm.bedId}/status`, {
        headers,
        data: { status: "AVAILABLE" },
      })
      const freed = beds.find((b) => b.id === adm.bedId)
      if (freed && !available.some((b) => b.id === freed.id)) {
        available.push({ ...freed, status: "AVAILABLE" })
      }
    }
  }

  return available
}
