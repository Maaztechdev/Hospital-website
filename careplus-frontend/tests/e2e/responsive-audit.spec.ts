import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { login, openDashboard, apiBase } from "./test-helpers"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const screenshotDir = path.resolve(__dirname, "../../../overnight/screenshots")

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true })
}

interface Issue {
  page: string
  viewport: string
  issue: string
}

test("responsive mobile and tablet audit for prompt 5", async ({ page, request }) => {
  test.setTimeout(240_000)

  const issues: Issue[] = []

  // Logins
  const adminSession = await login(request, { email: "admin@careplus.local", password: "Admin@12345" })
  const doctorSession = await login(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
  const pharmacistSession = await login(request, { email: "pharmacist@careplus.local", password: "Staff@12345" })
  const nurseSession = await login(request, { email: "nurse@careplus.local", password: "Staff@12345" })

  // Find an appointment for doctor consultation
  const apptRes = await request.get(`${apiBase}/appointments?limit=10`, {
    headers: { Authorization: `Bearer ${adminSession.accessToken}` },
  })
  let appointmentId = ""
  let mrNumber = "MR-2026-000001"
  if (apptRes.ok()) {
    const appts = (await apptRes.json()).data as Array<{ id: string; patient?: { mrNumber?: string } }>
    if (appts && appts.length > 0) {
      appointmentId = appts[0].id
      if (appts[0].patient?.mrNumber) {
        mrNumber = appts[0].patient.mrNumber
      }
    }
  }

  const testPages: Array<{
    name: string
    url: string
    session: typeof adminSession | null
  }> = [
    { name: "Public Home", url: "/", session: null },
    { name: "Public Doctors", url: "/doctors", session: null },
    { name: "Admin Dashboard", url: "/dashboard/admin", session: adminSession },
    { name: "Patients", url: "/dashboard/patients", session: adminSession },
    { name: "Patient Profile", url: `/dashboard/patients/${mrNumber}`, session: adminSession },
    { name: "OPD Queue", url: "/dashboard/queue", session: adminSession },
    {
      name: "Doctor Consultation",
      url: appointmentId
        ? `/dashboard/doctor/consultation/${appointmentId}?mr=${encodeURIComponent(mrNumber)}`
        : "/dashboard/doctor",
      session: doctorSession,
    },
    { name: "Lab Orders", url: "/dashboard/lab/orders", session: adminSession },
    { name: "Pharmacy Dashboard", url: "/dashboard/pharmacy", session: pharmacistSession },
    { name: "Pharmacy POS", url: "/dashboard/pharmacy/billing", session: pharmacistSession },
    { name: "Pharmacy Invoices", url: "/dashboard/pharmacy/invoices", session: pharmacistSession },
    { name: "Billing Invoices", url: "/dashboard/billing", session: adminSession },
    { name: "Wards/Beds", url: "/dashboard/ward", session: nurseSession },
    { name: "Nursing", url: "/dashboard/nurse", session: nurseSession },
    { name: "OT", url: "/dashboard/ot", session: doctorSession },
    { name: "Reports", url: "/dashboard/reports", session: adminSession },
  ]

  const viewports = [
    { name: "390px", width: 390, height: 844 },
    { name: "768px", width: 768, height: 1024 },
  ]

  for (const p of testPages) {
    if (p.session) {
      await openDashboard(page, p.session, p.url)
    } else {
      await page.goto(p.url)
    }
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(500)

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.waitForTimeout(400)

      const pageIssues = await page.evaluate(({ vpWidth }) => {
        const found: string[] = []

        // 1. Page horizontal scroll
        const scrollW = document.documentElement.scrollWidth
        const clientW = document.documentElement.clientWidth
        if (scrollW > clientW + 2) {
          found.push(`Page horizontal overflow: scrollWidth (${scrollW}px) > clientWidth (${clientW}px) by ${scrollW - clientW}px`)
        }

        // 2. Clipped tables without overflow container
        const tables = Array.from(document.querySelectorAll("table"))
        for (const tbl of tables) {
          const rect = tbl.getBoundingClientRect()
          let parent = tbl.parentElement
          let hasScrollableContainer = false
          while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent)
            if (style.overflowX === "auto" || style.overflowX === "scroll") {
              hasScrollableContainer = true
              break
            }
            parent = parent.parentElement
          }
          if (!hasScrollableContainer && rect.width > vpWidth) {
            found.push(`Table wider than viewport (${Math.round(rect.width)}px) without horizontal scroll wrapper`)
          }
        }

        // 3. Tap targets under 40px (excluding hidden or zero-size)
        const interactive = Array.from(document.querySelectorAll("button, a[href], input[type='checkbox'], input[type='radio']"))
        let smallTapCount = 0
        const smallSamples: string[] = []
        for (const el of interactive) {
          const rect = el.getBoundingClientRect()
          // Only check visible elements
          if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
            // Must have both dimensions >= 40 or min-height/min-width >= 40
            if (rect.width < 32 || rect.height < 32) {
              smallTapCount++
              if (smallSamples.length < 3) {
                const label = el.textContent?.trim().slice(0, 20) || el.getAttribute("aria-label") || el.tagName.toLowerCase()
                smallSamples.push(`"${label}" (${Math.round(rect.width)}x${Math.round(rect.height)}px)`)
              }
            }
          }
        }
        if (smallTapCount > 0) {
          found.push(`${smallTapCount} tap targets under minimum touch size (samples: ${smallSamples.join(", ")})`)
        }

        // 4. Primary buttons hidden
        const primaryBtns = Array.from(document.querySelectorAll("button[type='submit'], .btn-primary, button[data-primary='true']"))
        for (const btn of primaryBtns) {
          const style = window.getComputedStyle(btn)
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            found.push(`Primary button hidden: "${btn.textContent?.trim().slice(0, 20)}"`)
          }
        }

        return found
      }, { vpWidth: vp.width })

      if (pageIssues.length > 0) {
        for (const issue of pageIssues) {
          issues.push({
            page: p.name,
            viewport: vp.name,
            issue,
          })
        }
        const safeName = `${p.name.replace(/[^a-zA-Z0-9]/g, "_")}_${vp.name}.png`
        await page.screenshot({ path: path.join(screenshotDir, safeName), fullPage: false })
      }
    }
  }

  const outPath = path.resolve(__dirname, "../../../overnight/responsive-detection-results.json")
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2))
  console.log(`DETECTION_COMPLETE: ${issues.length} issues found.`)
})
