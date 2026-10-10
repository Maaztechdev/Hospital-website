import { expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const adminCredentials = { email: "admin@careplus.local", password: "Admin@12345" }

export async function createDoctorAppointment(request: APIRequestContext) {
  const login = await request.post(`${apiBase}/auth/login`, { data: adminCredentials })
  expect(login.ok()).toBeTruthy()
  const { accessToken } = (await login.json()).data as { accessToken: string }
  const headers = { Authorization: `Bearer ${accessToken}` }

  const doctorsResponse = await request.get(`${apiBase}/appointments/doctors`, { headers })
  expect(doctorsResponse.ok()).toBeTruthy()
  const doctors = (await doctorsResponse.json()).data as Array<{
    id: string
    user: { name: string }
    department: { id: string }
  }>
  const doctor = doctors.find((item) => item.user.name === "Dr. Ahmed Khan")
  expect(doctor, "The seeded consultation doctor must exist").toBeTruthy()

  let appointmentDate = ""
  let timeSlot = ""
  for (let offset = 1; offset <= 30 && !timeSlot; offset += 1) {
    const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${doctor!.id}/slots?date=${date}`, { headers })
    expect(slotsResponse.ok()).toBeTruthy()
    const availableSlots = ((await slotsResponse.json()).data as { availableSlots: string[] }).availableSlots
    if (availableSlots.length > 0) {
      appointmentDate = date
      timeSlot = availableSlots[0]
    }
  }
  expect(timeSlot, "The seeded doctor must have an available appointment slot").toBeTruthy()

  const patientsResponse = await request.get(`${apiBase}/patients?limit=100`, { headers })
  expect(patientsResponse.ok()).toBeTruthy()
  const patients = (await patientsResponse.json()).data as Array<{ id: string; mrNumber: string }>
  const patient = patients.find((item) => item.mrNumber === "MR-2026-000001") ?? patients[0]
  expect(patient, "At least one seeded patient must exist").toBeTruthy()

  const appointmentResponse = await request.post(`${apiBase}/appointments`, {
    headers,
    data: {
      patientId: patient!.id,
      doctorId: doctor!.id,
      departmentId: doctor!.department.id,
      appointmentDate,
      timeSlot,
      appointmentType: "CONSULTATION",
      source: "WALK_IN",
      reason: "Prescription consultation E2E",
    },
  })
  expect(appointmentResponse.ok(), await appointmentResponse.text()).toBeTruthy()
  const appointment = (await appointmentResponse.json()).data as { id: string }
  return { appointmentId: appointment.id, mrNumber: patient!.mrNumber, adminAccessToken: accessToken }
}
