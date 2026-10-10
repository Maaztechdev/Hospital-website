import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { createPrintE2EFixture, deletePrintE2EFixture, disconnectPrintE2EFixture } from "../../../careplus-backend/tests/helpers/print-e2e-fixture"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const adminCredentials = { email: "admin@careplus.local", password: "Admin@12345" }

async function signInForPrint(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: adminCredentials })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

async function assertPrintPage(page: Page, url: string, documentTitle: string, keyText: string) {
  await page.goto(url)
  await expect(page.getByRole("heading", { name: documentTitle })).toBeVisible()
  await expect(page.getByText(keyText, { exact: false })).toBeVisible()
  await page.waitForFunction(() => {
    const target = window as Window & { __printCallCount?: number; __printedText?: string }
    return target.__printCallCount === 1 && Boolean(target.__printedText?.trim())
  })
  const printedText = await page.evaluate(() => (window as Window & { __printedText?: string }).__printedText ?? "")
  expect(printedText).toContain(documentTitle)
  expect(printedText).toContain(keyText)
  const brokenImages = await page.locator("#careplus-print-root img").evaluateAll((images) =>
    images.filter((image) => !(image instanceof HTMLImageElement) || image.naturalWidth === 0).length,
  )
  expect(brokenImages).toBe(0)
}

test("patient, discharge, and prescription print routes load complete A4 documents before printing", async ({ page, request }) => {
  test.setTimeout(120_000)
  const fixture = await createPrintE2EFixture()
  try {
    const session = await signInForPrint(request)
    const headers = { Authorization: `Bearer ${session.accessToken}` }
    const admissionCheck = await request.get(`${apiBase}/wards/admissions/${fixture.admissionId}`, { headers })
    expect(admissionCheck.ok(), await admissionCheck.text()).toBeTruthy()
    const discharge = await request.post(`${apiBase}/wards/admissions/${fixture.admissionId}/discharge`, {
      headers,
      data: {
        diagnosis: "Print E2E diagnosis",
        courseInHospital: "Observed and treated during admission.",
        medications: ["Print E2E Medicine — 1 tablet daily for 3 days"],
        conditionAtDischarge: "Stable for discharge.",
        referral: "",
        instructions: "Return if symptoms worsen.",
        confirmUnpaidBalance: true,
      },
    })
    expect(discharge.ok(), await discharge.text()).toBeTruthy()

    await page.addInitScript(() => {
      Object.defineProperty(window, "__printCallCount", { configurable: true, writable: true, value: 0 })
      Object.defineProperty(window, "__printedText", { configurable: true, writable: true, value: "" })
      window.print = () => {
        const target = window as Window & { __printCallCount: number; __printedText: string }
        target.__printCallCount += 1
        target.__printedText = document.body.innerText
      }
    })
    await page.goto("/dashboard/login")
    await page.evaluate((tokens) => {
      sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
      sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
    }, session)

    await assertPrintPage(page, `/print/patient-summary/${fixture.patientId}`, "Patient Summary", fixture.patientName)
    await assertPrintPage(page, `/print/discharge/${fixture.admissionId}`, "Discharge Summary", "Print E2E diagnosis")
    await assertPrintPage(page, `/print/prescription/${fixture.consultationId}`, "Prescription", fixture.medicineName)
  } finally {
    await deletePrintE2EFixture(fixture)
    await disconnectPrintE2EFixture()
  }
})
