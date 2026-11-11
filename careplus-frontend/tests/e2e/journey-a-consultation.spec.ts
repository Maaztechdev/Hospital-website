import { test, expect, type APIRequestContext } from "@playwright/test"
import { apiBase, login, openDashboard } from "./test-helpers"

const doctorCredentials = { email: "dr.ahmed@careplus.local", password: "Doctor@12345" }
const receptionistCredentials = { email: "reception@careplus.local", password: "Staff@12345" }
const adminCredentials = { email: "admin@careplus.local", password: "Admin@12345" }

test("Patient Journey Spec A: Consultation flow from booking to addendum and doctor queue actions", async ({ page, request }) => {
  test.setTimeout(180_000)

  // 1. Setup tokens
  const adminSession = await login(request, adminCredentials)
  const doctorSession = await login(request, doctorCredentials)
  const receptionSession = await login(request, receptionistCredentials)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
  const receptionHeaders = { Authorization: `Bearer ${receptionSession.accessToken}` }

  // Get Dr. Ahmed Khan and his department
  const doctorsRes = await request.get(`${apiBase}/appointments/doctors`, { headers: receptionHeaders })
  expect(doctorsRes.ok()).toBeTruthy()
  const doctors = (await doctorsRes.json()).data as Array<{ id: string; user: { name: string }; department?: { id: string } }>
  const doctor = doctors.find((d) => d.user.name.includes("Ahmed")) ?? doctors[0]
  expect(doctor).toBeTruthy()
  const doctorId = doctor.id
  const departmentId = doctor.department?.id

  // Find an available slot in the future
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  let bookingDate = ""
  let bookingSlot = ""
  for (let offset = 1; offset <= 30 && !bookingSlot; offset++) {
    const target = new Date(Date.now() + offset * 86_400_000)
    const dateStr = target.toISOString().slice(0, 10)
    const slotRes = await request.get(`${apiBase}/appointments/doctors/${doctorId}/slots?date=${dateStr}`, { headers: receptionHeaders })
    if (slotRes.ok()) {
      const data = (await slotRes.json()).data as { availableSlots: string[] }
      if (data.availableSlots && data.availableSlots.length > 0) {
        bookingDate = dateStr
        bookingSlot = data.availableSlots[0]
      }
    }
  }
  expect(bookingSlot).toBeTruthy()

  // Step 1: Public Booking 3-step wizard
  await page.goto("/appointment")
  await expect(page.getByRole("heading", { name: /Let's find you a time/i })).toBeVisible()

  // Wizard Step 1: Specialist & Visit
  if (departmentId) {
    await page.locator("#department").selectOption(departmentId)
  }
  await page.locator("#doctor").selectOption(doctorId)
  await page.getByRole("button", { name: "Continue" }).click()

  // Wizard Step 2: Schedule
  await page.locator("#date").fill(bookingDate)
  await page.waitForTimeout(500)
  // Click the first available slot button
  const slotButton = page.locator(".grid button").first()
  await expect(slotButton).toBeVisible()
  await slotButton.click()
  await page.getByRole("button", { name: "Continue" }).click()

  // Wizard Step 3: Patient Details
  const suffix = Date.now().toString().slice(-6)
  const patientName = `Journey Patient ${suffix}`
  const patientPhone = `0300${suffix}1`
  await page.locator("#fullName").fill(patientName)
  await page.locator("#gender").selectOption("MALE")
  await page.locator("#phone").fill(patientPhone)
  await page.locator("#age").fill("34")
  await page.locator("#reason").fill("Consultation Journey E2E Test")
  await page.getByRole("button", { name: "Confirm Appointment" }).click()

  // Confirmation view
  await expect(page.getByRole("heading", { name: "Appointment Requested" })).toBeVisible()
  await expect(page.getByText(patientName)).toBeVisible()

  // Fetch the created appointment from backend
  const apptsRes = await request.get(`${apiBase}/appointments?limit=50&status=PENDING_APPROVAL`, { headers: receptionHeaders })
  expect(apptsRes.ok()).toBeTruthy()
  const appts = (await apptsRes.json()).data as Array<{ id: string; reason?: string; patient?: { phone?: string; mrNumber?: string }; status: string }>
  const createdAppt = appts.find((a) => a.reason === "Consultation Journey E2E Test" || a.patient?.phone === patientPhone) ?? appts[0]
  expect(createdAppt, "Created appointment must be found").toBeTruthy()
  const appointmentId = createdAppt.id
  const mrNumber = createdAppt.patient?.mrNumber ?? "MR-2026-000001"

  // Step 2: Receptionist confirms the appointment
  const confirmRes = await request.post(`${apiBase}/appointments/${appointmentId}/approve`, {
    headers: receptionHeaders,
  })
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy()

  // Step 3: OPD Queue — Doctor opens OPD Queue, marks Call Next (CONFIRMED -> WAITING)
  // Ensure no stale appointments in IN_CONSULTATION, WAITING, or CONFIRMED precede our appointment
  for (const status of ["IN_CONSULTATION", "WAITING", "CONFIRMED"]) {
    const res = await request.get(`${apiBase}/appointments?doctorId=${doctorId}&status=${status}&limit=50`, { headers: receptionHeaders })
    if (res.ok()) {
      const items = (await res.json()).data as Array<{ id: string }>
      for (const item of items) {
        if (item.id !== appointmentId) {
          if (status === "IN_CONSULTATION") {
            await request.post(`${apiBase}/appointments/${item.id}/mark-done`, { headers: doctorHeaders })
          } else {
            await request.post(`${apiBase}/appointments/${item.id}/cancel`, {
              headers: receptionHeaders,
              data: { reason: "E2E Queue cleanup" },
            })
          }
        }
      }
    }
  }

  // Doctor calls next patient in their queue (CONFIRMED -> WAITING)
  const callNextRes = await request.post(`${apiBase}/opd-queue/${doctorId}/call-next`, {
    headers: doctorHeaders,
  })
  expect(callNextRes.ok(), await callNextRes.text()).toBeTruthy()
  const calledAppt = (await callNextRes.json()).data as { id: string; status: string }
  expect(calledAppt.id).toBe(appointmentId)
  expect(calledAppt.status).toBe("WAITING")

  // Verify doctor requeue of their own WAITING appointment (Prompt 3 feature)
  const requeueRes = await request.post(`${apiBase}/opd-queue/${appointmentId}/requeue`, {
    headers: doctorHeaders,
  })
  expect(requeueRes.ok(), await requeueRes.text()).toBeTruthy()

  // Re-call next so appointment returns to WAITING state
  const recallRes = await request.post(`${apiBase}/opd-queue/${doctorId}/call-next`, {
    headers: doctorHeaders,
  })
  expect(recallRes.ok(), await recallRes.text()).toBeTruthy()

  // Step 4: Doctor Start Consultation
  await openDashboard(page, doctorSession, `/dashboard/doctor/consultation/${appointmentId}?mr=${encodeURIComponent(mrNumber)}`)
  await expect(page.getByRole("heading", { name: /Consultation — /i })).toBeVisible()

  // Step 5: Vitals with critical value (must demand confirmation)
  await page.getByLabel("Systolic (mmHg)").fill("130")
  await page.getByLabel("Diastolic (mmHg)").fill("85")
  await page.getByLabel("Pulse (bpm)").fill("75")
  await page.getByLabel("Temperature", { exact: true }).fill("98.4")
  await page.getByLabel("Weight (kg)").fill("70")
  await page.getByLabel("SpO2 (%)").fill("66") // Critical SpO2 < 90%
  await page.getByLabel("Chief Complaint").fill("Recurrent headaches and fatigue")

  // Check critical warning banner
  await expect(page.getByRole("alert").getByText("Critical value: SpO2 66%")).toBeVisible()

  // Attempt save draft -> triggers critical confirmation modal
  await page.getByRole("button", { name: "Save Draft" }).click()
  await expect(page.getByText("Confirm critical vital values")).toBeVisible()
  await page.getByLabel("I confirm these values are correct").check()
  await page.getByRole("button", { name: "Save Draft" }).click()
  await expect(page.getByText("Draft saved", { exact: true }).first()).toBeVisible()

  // Update SpO2 to normal value for clean consultation
  await page.getByLabel("SpO2 (%)").fill("98")
  await page.getByLabel("Diagnosis").fill("Essential (primary) hypertension (I10)")

  // Step 6: Structured Prescription
  const medRes = await request.get(`${apiBase}/pharmacy/medicines?limit=200`, { headers: doctorHeaders })
  expect(medRes.ok()).toBeTruthy()
  const medicines = (await medRes.json()).data as Array<{ id: string; name: string }>
  const selectedMed = medicines.find((m) => m.name.toLowerCase().includes("panadol")) ?? medicines[0]
  expect(selectedMed).toBeTruthy()

  await page.getByRole("button", { name: "Add Medicine" }).click()
  await page.getByLabel("Medicine 1").fill(selectedMed.name)
  const medDropdownItem = page.locator(`[data-medicine-id="${selectedMed.id}"] button`)
  if (await medDropdownItem.isVisible()) {
    await medDropdownItem.click()
  } else {
    await page.getByLabel("Dose").fill("1")
    await page.getByLabel("Duration").fill("3")
  }

  // Step 7: Lab Order & Ultrasound Recommendation
  const labTestsRes = await request.get(`${apiBase}/lab/catalog`, { headers: doctorHeaders })
  if (labTestsRes.ok()) {
    const labCatalog = (await labTestsRes.json()).data as Array<{ id: string; testName: string }>
    if (labCatalog.length > 0) {
      const firstLabBtn = page.getByRole("button", { name: labCatalog[0].testName, exact: true })
      if (await firstLabBtn.isVisible()) {
        await firstLabBtn.click()
      }
    }
  }

  // Suggest ultrasound recommendation
  const ultrasoundBtn = page.getByRole("button", { name: "Abdomen", exact: true })
  if (await ultrasoundBtn.isVisible()) {
    await ultrasoundBtn.click()
  }

  // Register dialog handler for window.confirm (allergy override & consultation completion)
  page.on("dialog", (dialog) => dialog.accept())

  // Step 8: Sign Prescription
  await page.getByRole("button", { name: "Sign Prescription" }).click()
  await expect(page.getByText("Prescription signed", { exact: true })).toBeVisible()

  // Step 9: Complete Consultation
  await page.getByRole("button", { name: "Complete Consultation" }).click()
  await expect(page.getByText(/visit has been marked done/i)).toBeVisible()

  // Step 10: Add Addendum
  await page.getByRole("button", { name: "Add Addendum" }).click()
  await page.getByLabel("Addendum note").fill("Post-consultation follow-up note recorded.")
  await page.getByRole("button", { name: "Save Addendum" }).click()
  await expect(page.getByText("Post-consultation follow-up note recorded.")).toBeVisible()
})
