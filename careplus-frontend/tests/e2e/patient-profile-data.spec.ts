import { expect, test, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const credentials = {
  admin: { email: "admin@careplus.local", password: "Admin@12345" },
  doctor: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
}

type Session = { accessToken: string; refreshToken: string }

async function login(request: APIRequestContext, role: keyof typeof credentials): Promise<Session> {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials[role] })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data
}

test("patient profile shows separate consultations for same-day appointments", async ({ page, request }) => {
  test.setTimeout(60_000)
  const admin = await login(request, "admin")
  const doctor = await login(request, "doctor")
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctor.accessToken}` }
  const suffix = Date.now().toString()
  let patientId: string | undefined

  try {
    const doctorsResponse = await request.get(`${apiBase}/appointments/doctors`, { headers: adminHeaders })
    expect(doctorsResponse.ok()).toBeTruthy()
    const doctors = (await doctorsResponse.json()).data as Array<{ id: string; user: { name: string }; department?: { id: string } | null }>
    const selectedDoctor = doctors.find((item) => item.user.name === "Dr. Ahmed Khan")
    expect(selectedDoctor?.department).toBeTruthy()
    if (!selectedDoctor?.department) throw new Error("Dr. Ahmed Khan must belong to a department for this profile test")

    const patientResponse = await request.post(`${apiBase}/patients`, {
      headers: adminHeaders,
      data: {
        firstName: "Profile",
        lastName: `Visits ${suffix}`,
        age: 35,
        gender: "OTHER",
        phone: `0300${suffix.slice(-7)}`,
        force: true,
      },
    })
    expect(patientResponse.ok()).toBeTruthy()
    const patient = (await patientResponse.json()).data as { id: string; mrNumber: string }
    patientId = patient.id

    const hospitalToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
    let appointmentDate = ""
    let availableSlots: string[] = []
    for (let offset = 1; offset <= 35 && availableSlots.length < 3; offset += 1) {
      const date = new Date(`${hospitalToday}T00:00:00.000Z`)
      date.setUTCDate(date.getUTCDate() + offset)
      if ([0, 6].includes(date.getUTCDay())) continue
      const candidate = date.toISOString().slice(0, 10)
      const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${selectedDoctor.id}/slots?date=${candidate}`, { headers: adminHeaders })
      expect(slotsResponse.ok()).toBeTruthy()
      const slots = (await slotsResponse.json()).data.availableSlots as string[]
      if (slots.length >= 3) {
        appointmentDate = candidate
        availableSlots = slots
      }
    }
    expect(availableSlots.length).toBeGreaterThanOrEqual(3)

    let thirdAppointmentId = ""
    for (const [index, timeSlot] of availableSlots.slice(0, 3).entries()) {
      const appointmentResponse = await request.post(`${apiBase}/appointments`, {
        headers: adminHeaders,
        data: {
          patientId: patient.id,
          doctorId: selectedDoctor.id,
          departmentId: selectedDoctor.department.id,
          appointmentDate,
          timeSlot,
          appointmentType: "NEW_VISIT",
          source: "WALK_IN",
          reason: `Profile visit ${index + 1}`,
        },
      })
      expect(appointmentResponse.ok()).toBeTruthy()
      const appointment = (await appointmentResponse.json()).data as { id: string }
      if (index < 2) {
        const consultationResponse = await request.post(`${apiBase}/consultations`, {
          headers: doctorHeaders,
          data: { appointmentId: appointment.id, diagnosis: `Profile diagnosis ${index + 1}` },
        })
        expect(consultationResponse.ok()).toBeTruthy()
      } else {
        thirdAppointmentId = appointment.id
      }
    }

    const profileResponse = await request.get(`${apiBase}/patients/${patient.id}/profile`, { headers: adminHeaders })
    expect(profileResponse.ok()).toBeTruthy()
    expect((await profileResponse.json()).data.consultations).toHaveLength(2)

    await page.goto("/dashboard/login")
    await page.evaluate((session) => {
      sessionStorage.setItem("careplus.accessToken", session.accessToken)
      sessionStorage.setItem("careplus.refreshToken", session.refreshToken)
    }, doctor)
    await page.goto(`/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await expect(page.getByRole("heading", { name: "Patient Profile" })).toBeVisible()
    await page.getByRole("tab", { name: "Visits", exact: true }).click()
    await expect(page.getByText(/Token #\d+ —/)).toHaveCount(2)
    await expect(page.getByText("Profile diagnosis 1", { exact: false })).toBeVisible()
    await expect(page.getByText("Profile diagnosis 2", { exact: false })).toBeVisible()
    await page.evaluate(async (appointmentId) => {
      const { api } = await import("/src/lib/api.ts")
      await api.createConsultation({ appointmentId, diagnosis: "Profile refreshed diagnosis" })
    }, thirdAppointmentId)
    await expect(page.getByText("Profile refreshed diagnosis", { exact: false })).toBeVisible()
  } finally {
    if (patientId) {
      const removed = await request.delete(`${apiBase}/patients/${patientId}`, { headers: adminHeaders })
      expect(removed.ok()).toBeTruthy()
    }
  }
})
