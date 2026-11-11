import { test, expect } from "@playwright/test"
import { apiBase, login } from "./test-helpers"

test("server-side appointment pagination and filtering scales across >1,000 appointments without truncation or client loops", async ({ request }) => {
  const adminSession = await login(request)
  const headers = { Authorization: `Bearer ${adminSession.accessToken}` }

  // 1. Verify total appointments in the test database exceeds 1,000
  const countRes = await request.get(`${apiBase}/appointments?limit=1`, { headers })
  expect(countRes.ok(), await countRes.text()).toBeTruthy()
  const meta = (await countRes.json()).pagination as { total: number; totalPages: number }
  expect(meta.total).toBeGreaterThanOrEqual(1000)

  // 2. Fetch page 1 (50 items)
  const page1Res = await request.get(`${apiBase}/appointments?page=1&limit=50&sort=date`, { headers })
  expect(page1Res.ok()).toBeTruthy()
  const page1Items = (await page1Res.json()).data as Array<{ id: string }>
  expect(page1Items).toHaveLength(50)

  // 3. Fetch page 2 (50 items)
  const page2Res = await request.get(`${apiBase}/appointments?page=2&limit=50&sort=date`, { headers })
  expect(page2Res.ok()).toBeTruthy()
  const page2Items = (await page2Res.json()).data as Array<{ id: string }>
  expect(page2Items).toHaveLength(50)

  // 4. Verify pages are disjoint (no duplicate IDs across pages)
  const page1Ids = new Set(page1Items.map((a) => a.id))
  for (const item of page2Items) {
    expect(page1Ids.has(item.id)).toBeFalsy()
  }

  // 5. Verify server-side status filter returns only matching status
  const confirmedRes = await request.get(`${apiBase}/appointments?status=CONFIRMED&limit=50`, { headers })
  expect(confirmedRes.ok()).toBeTruthy()
  const confirmedItems = (await confirmedRes.json()).data as Array<{ status: string }>
  for (const item of confirmedItems) {
    expect(item.status).toBe("CONFIRMED")
  }
})

