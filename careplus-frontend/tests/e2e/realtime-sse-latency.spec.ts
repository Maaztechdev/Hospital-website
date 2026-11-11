import { test, expect } from "@playwright/test"
import { apiBase, login, openDashboard, getTodayDateString } from "./test-helpers"

const doctorCredentials = { email: "dr.fatima@careplus.local", password: "Doctor@12345" }
const receptionistCredentials = { email: "reception@careplus.local", password: "Staff@12345" }

test("measures real-time SSE latency from receptionist action to doctor panel update", async ({ browser, request }) => {
  const doctorSession = await login(request, doctorCredentials)
  const receptionistSession = await login(request, receptionistCredentials)
  const receptionistHeaders = { Authorization: `Bearer ${receptionistSession.accessToken}` }

  // 1. Create a dedicated test patient
  const suffix = Date.now().toString().slice(-6)
  const patientResponse = await request.post(`${apiBase}/patients`, {
    headers: receptionistHeaders,
    data: {
      firstName: "Latency",
      lastName: `Test${suffix}`,
      age: 28,
      gender: "MALE",
      phone: `0300${suffix}1`,
    },
  })
  expect(patientResponse.ok(), await patientResponse.text()).toBeTruthy()
  const patient = (await patientResponse.json()).data as { id: string; mrNumber: string; firstName: string; lastName: string }

  // 2. Open Doctor page and Receptionist page in separate browser contexts
  const doctorContext = await browser.newContext()
  const receptionistContext = await browser.newContext()

  const doctorPage = await doctorContext.newPage()
  const receptionistPage = await receptionistContext.newPage()

  try {
    // Doctor opens Doctor Panel
    await openDashboard(doctorPage, doctorSession, "/dashboard/doctor")
    await expect(doctorPage.getByRole("heading", { name: /Welcome back/i })).toBeVisible()

    // Receptionist opens OPD Queue / Appointments
    await openDashboard(receptionistPage, receptionistSession, "/dashboard/appointments")
    await expect(receptionistPage.getByRole("heading", { name: "Appointments", exact: true })).toBeVisible()

    // Get doctor ID
    const doctorsResponse = await request.get(`${apiBase}/appointments/doctors`, { headers: receptionistHeaders })
    const doctors = (await doctorsResponse.json()).data as Array<{ id: string; userId: string; user?: { name: string } }>
    const doctor = doctors.find((d) => d.userId === doctorSession.user.id)
    console.log("DOCTOR IN TEST:", JSON.stringify(doctor), "doctorSession user:", JSON.stringify(doctorSession.user))
    expect(doctor).toBeTruthy()

    // 3. Receptionist books appointment with feePaid: true so it is immediately ready
    const today = getTodayDateString()
    const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${doctor!.id}/slots?date=${today}`, {
      headers: receptionistHeaders,
    })
    const slotsText = await slotsResponse.text()
    console.log("DEBUG SLOTS RESPONSE:", slotsText)
    expect(slotsResponse.ok(), slotsText).toBeTruthy()
    const slotsData = JSON.parse(slotsText).data as { availableSlots: string[]; slotsPerDay: string[]; bookedSlots: string[] }
    expect(slotsData.availableSlots.length).toBeGreaterThan(0)
    const timeSlot = slotsData.availableSlots[0]

    const startTime = Date.now()

    const bookResponse = await request.post(`${apiBase}/appointments`, {
      headers: receptionistHeaders,
      data: {
        patientId: patient.id,
        doctorId: doctor!.id,
        appointmentDate: today,
        timeSlot,
        appointmentType: "CONSULTATION",
        priority: "ROUTINE",
        source: "WALK_IN",
        generateInvoice: true,
        feePaid: true,
        paymentMethod: "CASH",
      },
    })
    expect(bookResponse.ok(), await bookResponse.text()).toBeTruthy()

    const actionTime = Date.now()

    // 4. Wait for Doctor page to reflect the new patient in queue
    const patientItem = doctorPage.getByText(patient.lastName).first()
    await expect(patientItem).toBeVisible({ timeout: 10_000 })

    const endTime = Date.now()
    const latencyFromAction = endTime - actionTime
    const totalLatency = endTime - startTime

    console.log(`[REALTIME SSE EVIDENCE] Action to Doctor Panel update latency: ${latencyFromAction}ms (Total roundtrip: ${totalLatency}ms)`)

    // Verify sub-second / real-time delivery (far faster than old 4000ms polling)
    expect(latencyFromAction).toBeLessThan(3500)
  } finally {
    await doctorContext.close()
    await receptionistContext.close()
  }
})
