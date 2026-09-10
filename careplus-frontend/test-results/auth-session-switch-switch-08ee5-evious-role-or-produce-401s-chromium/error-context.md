# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-session-switch.spec.ts >> switching sessions does not reuse the previous role or produce 401s
- Location: tests\e2e\auth-session-switch.spec.ts:12:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard\/admin$/
Received string:  "http://localhost:5173/dashboard/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    10 × locator resolved to <html lang="en">…</html>
       - unexpected value "http://localhost:5173/dashboard/login"

```

```yaml
- heading "Khalida Medicare Hospital" [level=1]
- paragraph: Staff & Admin Portal
- text: Email
- textbox "Email":
  - /placeholder: you@khalida.pk
  - text: admin@careplus.local
- text: Password
- textbox "Password":
  - /placeholder: ••••••••
  - text: Admin@12345
- button "Sign in to dashboard" [disabled]
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test"
  2  | 
  3  | const admin = { email: "admin@careplus.local", password: "Admin@12345" }
  4  | const receptionist = { email: "reception@careplus.local", password: "Staff@12345" }
  5  | 
  6  | async function signIn(page: Page, credentials: typeof admin) {
  7  |   await page.getByLabel("Email").fill(credentials.email)
  8  |   await page.getByLabel("Password").fill(credentials.password)
  9  |   await page.getByRole("button", { name: "Sign in to dashboard" }).click()
  10 | }
  11 | 
  12 | test("switching sessions does not reuse the previous role or produce 401s", async ({ page }) => {
  13 |   const unauthorizedResponses: string[] = []
  14 |   page.on("response", (response) => {
  15 |     if (response.status() === 401) unauthorizedResponses.push(response.url())
  16 |   })
  17 | 
  18 |   await page.goto("/dashboard/login")
  19 |   await signIn(page, admin)
> 20 |   await expect(page).toHaveURL(/\/dashboard\/admin$/)
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  21 |   await expect(page.getByText("Administrator", { exact: true })).toBeVisible()
  22 | 
  23 |   await page.getByRole("link", { name: "Patients" }).click()
  24 |   await expect(page).toHaveURL(/\/dashboard\/patients$/)
  25 |   await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible()
  26 | 
  27 |   await page.getByRole("button", { name: /Administrator/ }).click()
  28 |   await page.getByRole("button", { name: "Log out" }).click()
  29 |   await expect(page).toHaveURL(/\/dashboard\/login$/)
  30 | 
  31 |   await signIn(page, receptionist)
  32 |   await expect(page).toHaveURL(/\/dashboard\/appointments$/)
  33 |   await expect(page.getByText("Receptionist", { exact: true })).toBeVisible()
  34 |   await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible()
  35 |   await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0)
  36 |   expect(unauthorizedResponses, `401 responses: ${unauthorizedResponses.join(", ")}`).toEqual([])
  37 | })
```