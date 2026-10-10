import { test, expect } from "@playwright/test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { apiBase, first, login, openDashboard } from "./test-helpers"

let testSurgeryToClean: string | null = null

test.afterEach(() => {
  if (!testSurgeryToClean) return
  const backendPath = path.resolve(process.cwd(), "..", "careplus-backend")
  const runner = path.join(backendPath, "node_modules", "tsx", "dist", "cli.mjs")
  const result = spawnSync(process.execPath, [runner, "scripts/cleanup-e2e-surgery.ts", testSurgeryToClean], {
    cwd: backendPath,
    encoding: "utf8",
  })
  const surgeryId = testSurgeryToClean
  testSurgeryToClean = null
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to clean up E2E surgery ${surgeryId}: ${result.stderr || result.error?.message || "cleanup process failed"}`)
  }
})

test("OT surgery transitions through pre-op, surgery, recovery, and completion", async ({ page, request }) => {
  const session = await login(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const patient = (await first<Array<{ id: string; mrNumber: string; firstName: string; lastName: string }>>(request, "/patients?limit=1", headers))[0]
  const doctor = (await first<Array<{ id: string }>>(request, "/appointments/doctors", headers))[0]
  const room = (await first<Array<{ id: string; name: string }>>(request, "/ot/rooms", headers)).find((entry) => ["OT-1", "OT-2", "OT-3"].includes(entry.name))
  expect(room).toBeTruthy()
  const hospitalParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date())
  const part = (type: string) => hospitalParts.find((entry) => entry.type === type)?.value ?? "00"
  const today = `${part("year")}-${part("month")}-${part("day")}`
  const nowMinutes = Number(part("hour")) * 60 + Number(part("minute"))
  if (nowMinutes >= 19 * 60) test.skip(true, "No remaining operating hours today for the same-day pre-op workflow.")
  const existingToday = await first<Array<{ patient: { id: string }; scheduledStart: string }>>(request, `/ot/surgeries?date=${today}&limit=100`, headers)
  let slot = Math.max(8 * 60, Math.ceil((nowMinutes + 15) / 15) * 15)
  let data: Record<string, string> | undefined
  while (slot + 60 <= 20 * 60) {
    const hour = String(Math.floor(slot / 60)).padStart(2, "0")
    const minute = String(slot % 60).padStart(2, "0")
    const start = new Date(`${today}T${hour}:${minute}:00+05:00`)
    if (existingToday.some((surgery) => surgery.patient.id === patient.id && new Date(surgery.scheduledStart).getTime() === start.getTime())) {
      slot += 15
      continue
    }
    const candidate = {
      patientId: patient.id,
      otRoomId: room!.id,
      surgeryType: `E2E surgery ${Date.now()}`,
      anesthesiaType: "General",
      surgeonId: doctor.id,
      scheduledStart: start.toISOString(),
      scheduledEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
    }
    const available = await request.get(`${apiBase}/ot/surgeries/availability`, { headers, params: { ...candidate, priority: "ELECTIVE" } })
    if (available.ok() && (await available.json()).data.available) {
      data = candidate
      break
    }
    slot += 15
  }
  if (!data) test.skip(true, "No conflict-free operating-room slot remains today.")
  if (!data) throw new Error("No conflict-free operating-room slot remains today.")
  const create = await request.post(`${apiBase}/ot/surgeries`, { headers, data })
  expect(create.ok()).toBeTruthy()
  const surgery = (await create.json()).data as { id: string; scheduledStart: string }
  testSurgeryToClean = surgery.id
  const prematureStart = await request.post(`${apiBase}/ot/surgeries/${surgery.id}/start`, { headers, data: {} })
  expect(prematureStart.status()).toBe(409)

  await openDashboard(page, session, "/dashboard/ot")
  await expect(page.getByRole("heading", { name: /Operation Theatre/i })).toBeVisible()
  const surgeryCard = page.getByRole("button", { name: new RegExp(data.surgeryType) })
  await surgeryCard.click()
  const drawer = page.getByRole("dialog", { name: "Surgery details" })
  await expect(drawer).toBeVisible()
  for (const name of ["Consent signed", "NPO confirmed", "Labs done", "Blood arranged"]) {
    const checkbox = drawer.getByRole("checkbox", { name })
    if (!(await checkbox.isChecked())) await checkbox.click()
    await expect(checkbox).toBeChecked()
  }
  await drawer.getByRole("button", { name: "Start Pre-op" }).click()
  await expect(drawer.getByText("Pre-op", { exact: true }).first()).toBeVisible()
  await drawer.getByRole("button", { name: "Start Surgery" }).click()
  await expect(drawer.getByText("In Progress", { exact: true }).first()).toBeVisible()
  await drawer.getByLabel("Intra-operative notes").fill("No intra-operative complications.")
  await drawer.getByLabel("Outcome notes").fill("Patient stable.")
  await drawer.getByRole("button", { name: "Move to Recovery" }).first().click()
  await drawer.getByRole("button", { name: "Move to Recovery" }).last().click()
  await expect(drawer.getByText("Recovery", { exact: true }).first()).toBeVisible()
  await drawer.getByLabel("Post-op notes (required)").fill("Transferred to recovery in stable condition.")
  await drawer.getByRole("button", { name: "Complete" }).first().click()
  await drawer.getByRole("button", { name: "Complete" }).last().click()
  await expect(drawer.getByText("Completed", { exact: true }).first()).toBeVisible()
  const detailResponse = await request.get(`${apiBase}/ot/surgeries/${surgery.id}`, { headers })
  const completed = (await detailResponse.json()).data as { status: string; actualStartAt: string | null; actualEndAt: string | null; postOpNotes: string }
  expect(completed).toMatchObject({ status: "COMPLETED", postOpNotes: "Transferred to recovery in stable condition." })
  expect(completed.actualStartAt).toBeTruthy()
  expect(completed.actualEndAt).toBeTruthy()
  await drawer.getByRole("button", { name: "Close" }).click()
  await page.goto(`/dashboard/patients/${patient.mrNumber}`)
  await page.getByRole("tab", { name: "OT", exact: true }).click()
  await expect(page.getByText("Completed", { exact: true }).last()).toBeVisible()
})

test("doctor schedules their own surgery and sees it in the week view", async ({ page, request }) => {
  const adminSession = await login(request)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const suffix = Date.now().toString()
  const patient = (await first<Array<{ id: string; mrNumber: string; firstName: string; lastName: string }>>(request, "/patients?limit=1", adminHeaders))[0]
  expect(patient).toBeTruthy()

  const doctorList = await first<Array<{ id: string; user: { id: string; name: string } }>>(request, "/appointments/doctors", adminHeaders)
  const ownDoctor = doctorList.find((doctor) => doctor.user.name === "Dr. Fatima Sheikh")
  expect(ownDoctor).toBeTruthy()
  const rooms = await first<Array<{ id: string; name: string }>>(request, "/ot/rooms", adminHeaders)
  const room = rooms.find((candidate) => ["OT-1", "OT-2", "OT-3"].includes(candidate.name))
  expect(room).toBeTruthy()

  const linkedSurgeryStart = new Date(Date.UTC(2090, 0, 15 + Number(suffix.slice(-4)), 5))
  const linkedSurgery = await request.post(`${apiBase}/ot/surgeries`, {
    headers: adminHeaders,
    data: {
      patientId: patient.id,
      otRoomId: room.id,
      surgeryType: `OT E2E patient access ${suffix}`,
      anesthesiaType: "General",
      surgeonId: ownDoctor!.id,
      scheduledStart: linkedSurgeryStart.toISOString(),
      scheduledEnd: new Date(linkedSurgeryStart.getTime() + 60 * 60 * 1000).toISOString(),
    },
  })
  expect(linkedSurgery.status()).toBe(201)

  const session = await login(request, { email: "dr.fatima@careplus.local", password: "Doctor@12345" })
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const visiblePatients = await first<Array<{ id: string; mrNumber: string }>>(request, "/patients?limit=100", headers)
  expect(visiblePatients.some((item) => item.id === patient.id)).toBeTruthy()
  const visibleDoctors = await first<Array<{ id: string; user: { id: string } }>>(request, "/appointments/doctors", headers)
  expect(visibleDoctors.find((doctor) => doctor.id === ownDoctor!.id)?.user.id).toBe(session.user.id)

  const initialSurgeriesLoaded = page.waitForResponse((response) =>
    response.url().includes("/ot/surgeries?") && response.request().method() === "GET"
  )
  await openDashboard(page, session, "/dashboard/ot")
  await initialSurgeriesLoaded
  await expect(page.getByText("Dr. Fatima Sheikh", { exact: true })).toBeVisible()
  await expect(page.getByText("Loading live hospital data...", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Schedule Surgery" }).last().click()
  const availabilityRequests: string[] = []
  page.on("request", (req) => {
    if (req.url().includes("/ot/surgeries/availability")) availabilityRequests.push(req.url())
  })
  await page.getByPlaceholder("e.g. MR-2026-000101").fill(patient.mrNumber)
  const procedureName = `OT E2E schedule ${suffix}`
  await page.getByPlaceholder("Search or enter a procedure").fill(procedureName)
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(page.getByText("Unable to complete request")).toHaveCount(0)
  expect(availabilityRequests).toHaveLength(0)
  await page.getByRole("button", { name: "Next" }).click()

  const surgeonSelect = page.getByText("Surgeon", { exact: true }).locator("..").locator("select")
  await expect(surgeonSelect).toHaveValue(ownDoctor!.id)
  await expect(surgeonSelect).toBeDisabled()
  await page.getByText("OT Room", { exact: true }).locator("..").locator("select").selectOption(room.name)

  const defaultDate = await page.locator('input[type="date"]').inputValue()
  const timeSelect = page.getByText("Time", { exact: true }).locator("..").locator("select")
  const defaultTime = await timeSelect.inputValue()
  const defaultTimeLabel = await timeSelect.locator("option:checked").textContent()
  expect(defaultTimeLabel).toMatch(/\b(AM|PM)\b/)
  expect(defaultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(new Date(`${defaultDate}T${defaultTime}:00+05:00`).getTime()).toBeGreaterThan(Date.now())

  const currentHospitalParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())
  const currentHospitalPart = (type: string) => currentHospitalParts.find((part) => part.type === type)?.value ?? "00"
  const todayText = `${currentHospitalPart("year")}-${currentHospitalPart("month")}-${currentHospitalPart("day")}`
  const currentHospitalMinutes = Number(currentHospitalPart("hour")) * 60 + Number(currentHospitalPart("minute"))
  if (currentHospitalMinutes > 8 * 60) {
    await page.locator('input[type="date"]').fill(todayText)
    await expect(timeSelect.locator('option[value="08:00"]')).toBeDisabled()
  }

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(tomorrow)
  const datePart = (type: string) => dateParts.find((part) => part.type === type)?.value ?? "00"
  const dateText = `${datePart("year")}-${datePart("month")}-${datePart("day")}`
  expect([todayText, dateText]).toContain(defaultDate)
  let scheduledTime = "10:30"
  const firstCandidate = Number(suffix.slice(-4)) % 45
  let foundAvailableSlot = false
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const slotMinutes = 8 * 60 + ((firstCandidate + attempt) % 45) * 15
    const slot = `${String(Math.floor(slotMinutes / 60)).padStart(2, "0")}:${String(slotMinutes % 60).padStart(2, "0")}`
    const endMinutes = slotMinutes + 60
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`
    const query = new URLSearchParams({
      patientId: patient.id,
      otRoomId: room.id,
      surgeonId: ownDoctor!.id,
      scheduledStart: `${dateText}T${slot}:00+05:00`,
      scheduledEnd: `${dateText}T${end}:00+05:00`,
      priority: "ELECTIVE",
    })
    const availabilityResponse = await request.get(`${apiBase}/ot/surgeries/availability?${query}`, { headers })
    expect(availabilityResponse.ok()).toBeTruthy()
    if ((await availabilityResponse.json()).data.available) {
      scheduledTime = slot
      foundAvailableSlot = true
      break
    }
  }
  expect(foundAvailableSlot, "An available one-hour room slot should exist tomorrow").toBe(true)
  await page.locator('input[type="date"]').fill(dateText)
  await timeSelect.selectOption(scheduledTime)
  await page.getByText("Anesthesia Type", { exact: true }).locator("..").locator("select").selectOption("General")
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByLabel("Consent signed").check()
  await page.getByLabel("NPO confirmed").check()
  await page.getByLabel("Labs done").check()
  await page.getByLabel("Blood arranged").check()
  const surgeryResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/ot/surgeries") && response.request().method() === "POST"
  )
  const scheduleRequestPromise = page.waitForRequest((req) =>
    new URL(req.url()).pathname.endsWith("/ot/surgeries") && req.method() === "POST"
  )
  const surgeryDetailResponsePromise = page.waitForResponse((response) =>
    /\/ot\/surgeries\/[^/?]+$/.test(new URL(response.url()).pathname) && response.request().method() === "GET"
  )
  await page.getByRole("button", { name: "Schedule Surgery" }).last().click()
  await page.getByRole("button", { name: "Schedule", exact: true }).click()
  const scheduleRequest = await scheduleRequestPromise
  expect(scheduleRequest.postDataJSON().scheduledStart).toMatch(/\+05:00$/)
  expect(scheduleRequest.postDataJSON().scheduledEnd).toMatch(/\+05:00$/)
  const surgeryResponse = await surgeryResponsePromise
  expect(surgeryResponse.status()).toBe(201)
  const scheduledSurgery = (await surgeryResponse.json()).data as { scheduledStart: string }
  expect(new Date(scheduledSurgery.scheduledStart).toISOString()).toBe(new Date(`${dateText}T${scheduledTime}:00+05:00`).toISOString())
  const surgeryDetailResponse = await surgeryDetailResponsePromise
  const surgeryDetail = (await surgeryDetailResponse.json()).data as { id: string }
  testSurgeryToClean = surgeryDetail.id
  expect(surgeryDetail.otRoom.name).toBe(room.name)

  await expect(page.getByText("Surgery scheduled", { exact: true })).toBeVisible()
  const displayedTime = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(`2020-01-01T${scheduledTime}:00Z`))
  const surgeryCard = page.getByRole("button", { name: new RegExp(`${displayedTime}.*${patient.firstName}`) }).first()
  await expect(surgeryCard).toBeVisible()
  await expect(page.getByText(/^Week View/)).toBeVisible()
  await surgeryCard.click()
  const surgeryDrawer = page.getByRole("dialog", { name: "Surgery details" })
  await expect(surgeryDrawer.getByText(procedureName, { exact: true })).toBeVisible()
  await expect(surgeryDrawer.getByText("Scheduled", { exact: true })).toBeVisible()
  await expect(surgeryDrawer.getByRole("button", { name: "Start Pre-op" })).toBeVisible()
  await expect(surgeryDrawer.getByRole("button", { name: "Postpone" })).toBeVisible()
  await surgeryDrawer.getByRole("button", { name: "Close" }).click()

  await page.goto(`/dashboard/patients/${patient.mrNumber}`)
  await page.getByRole("tab", { name: "OT", exact: true }).click()
  await expect(page.getByText(procedureName, { exact: true })).toBeVisible()
  await expect(page.getByText("Scheduled", { exact: true }).last()).toBeVisible()
  await expect(page.getByText(new RegExp(displayedTime)).first()).toBeVisible()

  await page.goto("/dashboard/ward")
  await page.getByRole("button", { name: "Admit Patient" }).click()
  await page.getByRole("tab", { name: "Doctor & Timing" }).click()
  const attendingDoctorSelect = page.getByText("Attending Doctor", { exact: true }).locator("..").locator("select")
  await expect(attendingDoctorSelect).toHaveValue(ownDoctor!.id)
})
