import { test, expect } from "@playwright/test"
import { login } from "./test-helpers"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"

const receptionistCredentials = { email: "reception@careplus.local", password: "Staff@12345" }
const doctorCredentials = { email: "dr.ahmed@careplus.local", password: "Doctor@12345" }

test.describe("OPD Fee Gating E2E", () => {
  test("booking without payment creates unpaid invoice, doctor cannot start consultation until fee is paid or waived", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)

    // 1. Login as receptionist & doctor & admin
    const [receptionistSession, doctorSession, adminSession] = await Promise.all([
      login(request, receptionistCredentials),
      login(request, doctorCredentials),
      login(request),
    ])
    const receptionistHeaders = { Authorization: `Bearer ${receptionistSession.accessToken}` }
    const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
    const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }

    // 2. Fetch doctor profile
    const doctorRes = await request.get(`${apiBase}/appointments/doctors`, { headers: receptionistHeaders })
    expect(doctorRes.ok()).toBeTruthy()
    const doctors = (await doctorRes.json()).data
    const doctor = doctors.find((d: any) => d.name === "Dr. Ahmed Khan" || d.user?.name === "Dr. Ahmed Khan") || doctors[0]

    let appointmentDate = ""
    let timeSlot = ""
    for (let offset = 1; offset <= 30 && !timeSlot; offset += 1) {
      const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const slotsRes = await request.get(`${apiBase}/appointments/doctors/${doctor.id}/slots?date=${d}`, {
        headers: receptionistHeaders,
      })
      if (slotsRes.ok()) {
        const slots = (await slotsRes.json()).data.availableSlots
        if (slots && slots.length > 0) {
          appointmentDate = d
          timeSlot = slots[0]
        }
      }
    }
    expect(timeSlot).toBeTruthy()

    // 3. Register patient
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const patientRes = await request.post(`${apiBase}/patients`, {
      headers: receptionistHeaders,
      data: {
        firstName: "FeeGating",
        lastName: `Patient-${suffix}`,
        phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
        gender: "MALE",
        age: 35,
        address: "E2E Test Street, Lahore",
      },
    })
    expect(patientRes.ok(), await patientRes.text()).toBeTruthy()
    const patient = (await patientRes.json()).data

    // 4. Book appointment WITHOUT feePaid or feeWaived (default behavior)
    const apptRes = await request.post(`${apiBase}/appointments`, {
      headers: receptionistHeaders,
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        departmentId: doctor.department?.id || doctor.departmentId,
        appointmentDate,
        timeSlot,
        appointmentType: "CONSULTATION",
        source: "WALK_IN",
        reason: "OPD fee gating verification",
      },
    })
    expect(apptRes.ok(), await apptRes.text()).toBeTruthy()
    const appointment = (await apptRes.json()).data

    // 5. Verify invoice was created by DEFAULT and is UNPAID
    const invoiceRes = await request.get(`${apiBase}/billing/invoices?patientId=${patient.id}`, {
      headers: receptionistHeaders,
    })
    expect(invoiceRes.ok()).toBeTruthy()
    const invoices = (await invoiceRes.json()).data
    expect(invoices.length).toBeGreaterThanOrEqual(1)
    const unpaidInvoice = invoices[0]
    expect(Number(unpaidInvoice.balanceAmount)).toBeGreaterThan(0)
    expect(unpaidInvoice.status).toBe("FINALIZED")

    // 6. Verify starting consultation via API without payment/waiver is BLOCKED with 400
    const startRes = await request.post(`${apiBase}/consultations`, {
      headers: doctorHeaders,
      data: {
        appointmentId: appointment.id,
        chiefComplaint: "Fee gating test complaint",
      },
    })
    const startResText = await startRes.text()
    expect(startRes.status(), startResText).toBe(400)
    const startErr = await startRes.json()
    expect(startErr.message).toMatch(/Consultation fee of PKR \d+ is unpaid/i)

    // 7. Verify doctor in UI is blocked when saving draft without fee payment
    await page.goto("/dashboard/login")
    await page.getByLabel("Email").fill("dr.ahmed@careplus.local")
    await page.getByLabel("Password").fill("Doctor@12345")
    await page.getByRole("button", { name: "Sign in to dashboard" }).click()
    await expect(page).toHaveURL(/\/dashboard\/doctor$/)

    // Navigate to consultation
    await page.goto(`/dashboard/doctor/consultation/${appointment.id}?mr=${encodeURIComponent(patient.mrNumber)}`)
    await expect(page.getByRole("heading", { name: /Consultation — .*MR-/ })).toBeVisible({ timeout: 15_000 })
    await page.getByLabel("Chief Complaint").fill("Fee gating complaint")

    // Click Save Draft
    await page.getByRole("button", { name: "Save Draft" }).click()

    // Assert doctor sees the clear unpaid fee toast message
    await expect(
      page.getByText(/Cannot start consultation: Consultation fee of PKR \d+ is unpaid/i),
    ).toBeVisible({ timeout: 10_000 })

    // 8. Receptionist records an authorized fee waiver with mandatory reason
    const waiveRes = await request.post(`${apiBase}/appointments/${appointment.id}/waive-fee`, {
      headers: receptionistHeaders,
      data: {
        reason: "Hospital welfare board authorized emergency fee waiver",
      },
    })
    expect(waiveRes.ok(), await waiveRes.text()).toBeTruthy()

    // 9. Doctor clicks "Save Draft" again
    await page.getByRole("button", { name: "Save Draft" }).click()

    // 10. Consultation draft now saves successfully!
    await expect(page.getByText(/^Draft saved(?:\s|$)/).first()).toBeVisible({ timeout: 10_000 })

    // 11. Verify audit log entry was written for fee waiver with exact reason
    const auditRes = await request.get(
      `${apiBase}/audit-logs?entityType=AppointmentFeeWaiver&entityId=${appointment.id}`,
      { headers: adminHeaders },
    )
    expect(auditRes.ok()).toBeTruthy()
    const auditLogs = (await auditRes.json()).data
    expect(auditLogs.length).toBeGreaterThanOrEqual(1)
    expect(auditLogs[0].reason).toContain("Hospital welfare board authorized emergency fee waiver")
  })
})
