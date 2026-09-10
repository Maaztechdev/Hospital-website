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

  const patientsResponse = await request.get(`${apiBase}/patients?limit=1`, { headers: receptionistHeaders })
  const doctorsResponse = await request.get(`${apiBase}/appointments/doctors`, { headers: receptionistHeaders })
  expect(patientsResponse.ok()).toBeTruthy()
  expect(doctorsResponse.ok()).toBeTruthy()
  const patient = (await patientsResponse.json()).data[0] as { id: string }
  const selectedDoctor = (await doctorsResponse.json()).data.find((item: { user: { name: string } }) => item.user.name === "Dr. Ahmed Khan")
  expect(selectedDoctor).toBeTruthy()

  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1)
  const appointmentDate = date.toISOString().slice(0, 10)
  const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${selectedDoctor.id}/slots?date=${appointmentDate}`, { headers: receptionistHeaders })
  expect(slotsResponse.ok()).toBeTruthy()
  const slots = (await slotsResponse.json()).data.availableSlots as string[]
  expect(slots.length).toBeGreaterThan(0)

  const createResponse = await request.post(`${apiBase}/appointments`, {
    headers: receptionistHeaders,
    data: { patientId: patient.id, doctorId: selectedDoctor.id, appointmentDate, timeSlot: slots[0], appointmentType: "CONSULTATION", source: "WALK_IN" },
  })
  expect(createResponse.ok()).toBeTruthy()
  const created = (await createResponse.json()).data as Appointment
  expect(created.status).toBe("PENDING_APPROVAL")
  expect((await getAppointment(request, created.id, receptionist.accessToken)).status).toBe("PENDING_APPROVAL")

  const approveResponse = await request.post(`${apiBase}/appointments/${created.id}/approve`, { headers: doctorHeaders })
  expect(approveResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("CONFIRMED")

  const checkInResponse = await request.post(`${apiBase}/opd-queue/${selectedDoctor.id}/call-next`, { headers: receptionistHeaders })
  expect(checkInResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, receptionist.accessToken)).status).toBe("WAITING")

  const startResponse = await request.post(`${apiBase}/opd-queue/${created.id}/start-consultation`, { headers: doctorHeaders })
  expect(startResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("IN_CONSULTATION")

  const doneResponse = await request.post(`${apiBase}/appointments/${created.id}/mark-done`, { headers: doctorHeaders })
  expect(doneResponse.ok()).toBeTruthy()
  expect((await getAppointment(request, created.id, doctor.accessToken)).status).toBe("DONE")
})