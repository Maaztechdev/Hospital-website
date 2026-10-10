import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const credentials = {
  receptionist: { email: "reception@careplus.local", password: "Staff@12345" },
  doctor: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
}

type Session = { accessToken: string; refreshToken: string }
type Appointment = { id: string; status: string }

async function login(request: APIRequestContext, role: keyof typeof credentials): Promise<Session> {
  const response = await request.post(`${apiBase}/auth/login`, { data: credentials[role] })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data
}

async function getAppointment(request: APIRequestContext, id: string, token: string): Promise<Appointment> {
  const response = await request.get(`${apiBase}/appointments/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data
}

test("appointment lifecycle completes across receptionist and doctor roles", async ({ request }) => {
  const receptionist = await login(request, "receptionist")
  const doctor = await login(request, "doctor")
  const receptionistHeaders = { Authorization: `Bearer ${receptionist.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctor.accessToken}` }

  const doctorsResponse = await request.get(`${apiBase}/appointments/doctors`, { headers: receptionistHeaders })
  expect(doctorsResponse.ok()).toBeTruthy()
  const selectedDoctor = (await doctorsResponse.json()).data.find((item: { user: { name: string }; department?: { id: string } | null }) => item.user.name === "Dr. Ahmed Khan") as { id: string; department?: { id: string } | null } | undefined
  expect(selectedDoctor).toBeTruthy()
  if (!selectedDoctor?.department) throw new Error("Dr. Ahmed Khan must belong to a department for this lifecycle test")

  const hospitalToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const firstDate = new Date(`${hospitalToday}T00:00:00.000Z`)
  let appointmentDate = ""
  let slots: string[] = []
  for (let offset = 1; offset <= 35 && slots.length === 0; offset += 1) {
    const date = new Date(firstDate)
    date.setUTCDate(date.getUTCDate() + offset)
    if ([0, 6].includes(date.getUTCDay())) continue
    const candidateDate = date.toISOString().slice(0, 10)
    const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${selectedDoctor.id}/slots?date=${candidateDate}`, { headers: receptionistHeaders })
    expect(slotsResponse.ok()).toBeTruthy()
    slots = (await slotsResponse.json()).data.availableSlots as string[]
    if (slots.length > 0) appointmentDate = candidateDate
  }
  expect(slots.length).toBeGreaterThan(0)

  const createResponse = await request.post(`${apiBase}/appointments/public`, {
    data: {
      fullName: `Lifecycle E2E ${Date.now()}`,
      phone: `0300${String(Date.now()).slice(-7)}`,
      age: 32,
      doctorId: selectedDoctor.id,
      departmentId: selectedDoctor.department.id,
      appointmentDate,
      timeSlot: slots[0],
      reason: "Lifecycle status workflow test",
    },
  })
  const createBody = await createResponse.json()
  expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy()
  const created = createBody.data as Appointment
  expect(created.status).toBe("PENDING_APPROVAL")
  expect((await getAppointment(request, created.id, receptionist.accessToken)).status).toBe("PENDING_APPROVAL")

  const approveResponse = await request.post(`${apiBase}/appointments/${created.id}/approve`, { headers: doctorHeaders })
  expect(approveResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("CONFIRMED")

  const startResponse = await request.post(`${apiBase}/opd-queue/${created.id}/start-consultation`, { headers: doctorHeaders })
  expect(startResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("IN_CONSULTATION")

  const doneResponse = await request.post(`${apiBase}/appointments/${created.id}/mark-done`, { headers: doctorHeaders })
  const doneBody = await doneResponse.json()
  expect(doneResponse.ok(), JSON.stringify(doneBody)).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("COMPLETED")
})