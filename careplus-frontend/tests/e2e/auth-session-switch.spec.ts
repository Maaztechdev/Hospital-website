import { test, expect, type Page } from "@playwright/test"

const admin = { email: "admin@careplus.local", password: "Admin@12345" }
const receptionist = { email: "reception@careplus.local", password: "Staff@12345" }

async function signIn(page: Page, credentials: typeof admin) {
  await page.getByLabel("Email").fill(credentials.email)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: "Sign in to dashboard" }).click()
}

test("switching sessions does not reuse the previous role or produce 401s", async ({ page }) => {
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

  await signIn(page, receptionist)
  await expect(page).toHaveURL(/\/dashboard\/appointments$/)
  await expect(page.getByText("Receptionist", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0)
  expect(unauthorizedResponses, `401 responses: ${unauthorizedResponses.join(", ")}`).toEqual([])
})