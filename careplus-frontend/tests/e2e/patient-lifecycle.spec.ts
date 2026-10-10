import { expect, test, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const users = {
  admin: { email: "admin@careplus.local", password: "Admin@12345" },
  receptionist: { email: "reception@careplus.local", password: "Staff@12345" },
  doctor: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
}

type Session = { accessToken: string }
type Json = { data: any }

async function login(request: APIRequestContext, user: keyof typeof users): Promise<Session> {
  const response = await request.post(`${apiBase}/auth/login`, { data: users[user] })
  expect(response.status()).toBe(200)
  return (await response.json()).data
}

async function call(request: APIRequestContext, method: "get" | "post" | "patch", path: string, token: string, data?: unknown): Promise<any> {
  const response = await request[method](`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` }, data })
  expect(response.ok(), `${method.toUpperCase()} ${path} failed with ${response.status()}`).toBeTruthy()
  return (await response.json() as Json).data
}

test("patient lifecycle runs from registration through clinical, billing, lab, and ward care", async ({ request }) => {
  const admin = await login(request, "admin")
  const receptionist = await login(request, "receptionist")
  const doctor = await login(request, "doctor")
  const receptionHeaders = receptionist.accessToken
  const suffix = Date.now().toString()

  const patient = await call(request, "post", "/patients", receptionHeaders, {
    firstName: "Lifecycle", lastName: `Patient ${suffix}`, age: 35, gender: "OTHER", phone: `0300${suffix}${Math.floor(Math.random() * 10)}`, force: true,
  })
  expect(patient.mrNumber).toBeTruthy()

  const doctors = await call(request, "get", "/appointments/doctors", receptionHeaders)
  const selectedDoctor = doctors.find((item: { user: { name: string } }) => item.user.name === "Dr. Ahmed Khan")
  expect(selectedDoctor).toBeTruthy()
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1)
  const dateText = date.toISOString().slice(0, 10)
  const slots = await call(request, "get", `/appointments/doctors/${selectedDoctor.id}/slots?date=${dateText}`, receptionHeaders)
  const appointment = await call(request, "post", "/appointments", receptionHeaders, {
    patientId: patient.id, doctorId: selectedDoctor.id, appointmentDate: dateText, timeSlot: slots.availableSlots[0], appointmentType: "NEW_VISIT", source: "WALK_IN",
  })
  expect(appointment.status).toBe("CONFIRMED")
  await call(request, "post", `/opd-queue/${appointment.id}/start-consultation`, doctor.accessToken)

  const consultation = await call(request, "post", "/consultations", doctor.accessToken, { appointmentId: appointment.id, diagnosis: "Lifecycle diagnosis" })
  const prescription = await call(request, "post", "/prescriptions", doctor.accessToken, {
    consultationId: consultation.id, items: [{ medicineName: "Lifecycle Medicine", isCatalogItem: false, doseAmount: 1, doseUnit: "tablet", route: "Oral", frequencyCode: "OD", durationValue: 5, durationUnit: "days" }],
  })
  await call(request, "post", `/prescriptions/${prescription.id}/sign`, doctor.accessToken)
  await call(request, "post", `/consultations/${consultation.id}/sign`, doctor.accessToken)
  await call(request, "post", "/appointments/" + appointment.id + "/mark-done", doctor.accessToken)

  const labTests = await call(request, "get", "/lab/tests", admin.accessToken)
  const labOrder = await call(request, "post", "/lab/orders", doctor.accessToken, { patientId: patient.id, doctorId: selectedDoctor.id, testId: labTests[0].id, priority: "ROUTINE" })
  await call(request, "patch", `/lab/orders/${labOrder.id}/sample-status`, admin.accessToken, { status: "SAMPLE_COLLECTED" })
  const labParameters = labTests[0].parameters ?? []
  const labResult = labParameters.length
    ? { parameters: labParameters.map((parameter: { id: string; resultType: string }) => ({ parameterId: parameter.id, value: parameter.resultType === "NUMERIC" ? "5.4" : "Observed" })) }
    : { resultValue: "Normal", interpretation: "NORMAL" as const }
  await call(request, "post", `/lab/orders/${labOrder.id}/results`, admin.accessToken, labResult)
  await call(request, "post", `/lab/orders/${labOrder.id}/verify`, admin.accessToken)

  const invoice = await call(request, "post", "/billing/invoices", admin.accessToken, {
    patientId: patient.id, items: [{ itemType: "CONSULTATION", description: "Lifecycle consultation", quantity: 1, unitPrice: 1500 }],
  })
  await call(request, "post", `/billing/invoices/${invoice.id}/payments`, admin.accessToken, { paymentMethod: "CASH", amount: 1500 })

  const beds = await call(request, "get", "/wards/beds/availability", admin.accessToken)
  const bed = beds.find((item: { status: string }) => item.status === "AVAILABLE")
  expect(bed).toBeTruthy()
  const admission = await call(request, "post", "/wards/admissions", admin.accessToken, {
    patientId: patient.id, bedId: bed.id, attendingDoctorId: selectedDoctor.id, admissionType: "PLANNED", admissionReason: "Lifecycle observation", depositAmount: 1,
  })
  await call(request, "post", "/nursing/vitals", doctor.accessToken, { admissionId: admission.id, temperature: 37, pulse: 72, oxygenSaturation: 98 })
  await call(request, "post", `/wards/admissions/${admission.id}/discharge`, doctor.accessToken, {
    diagnosis: "Lifecycle observation",
    conditionAtDischarge: "Stable",
    instructions: "Return if symptoms worsen.",
  })

  expect((await call(request, "get", `/patients/${patient.id}`, admin.accessToken)).id).toBe(patient.id)
})
