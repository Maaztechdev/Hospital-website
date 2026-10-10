import { test, expect, type APIRequestContext, type Page } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const credentials = {
  admin: { email: "admin@careplus.local", password: "Admin@12345" },
  doctor: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
  receptionist: { email: "reception@careplus.local", password: "Staff@12345" },
}

type Session = { accessToken: string; refreshToken: string }
type PatientFixture = { id: string; mrNumber: string; name: string }
type AdmissionFixture = { id: string; patientId: string; bedId: string; admissionReason: string; status: string }

async function login(request: APIRequestContext, user: typeof credentials[keyof typeof credentials]) {
  const response = await request.post(`${apiBase}/auth/login`, { data: user })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as Session
}

async function createPatient(request: APIRequestContext, headers: Record<string, string>, suffix: string): Promise<PatientFixture> {
  const response = await request.post(`${apiBase}/patients`, {
    headers,
    data: { firstName: "Admission Flow", lastName: suffix, age: 36, gender: "OTHER", phone: `0300${Date.now().toString().slice(-7)}${suffix.slice(-1)}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const patient = (await response.json()).data as { id: string; mrNumber: string; firstName: string; lastName: string }
  return { id: patient.id, mrNumber: patient.mrNumber, name: `${patient.firstName} ${patient.lastName}` }
}

async function linkDoctorPatient(request: APIRequestContext, headers: Record<string, string>, patientId: string, doctorId: string, departmentId: string) {
  for (let offset = 1; offset <= 30; offset += 1) {
    const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    const slotsResponse = await request.get(`${apiBase}/appointments/doctors/${doctorId}/slots?date=${date}`, { headers })
    expect(slotsResponse.ok(), await slotsResponse.text()).toBeTruthy()
    const slots = ((await slotsResponse.json()).data as { availableSlots: string[] }).availableSlots
    if (!slots.length) continue
    const created = await request.post(`${apiBase}/appointments`, {
      headers,
      data: {
        patientId,
        doctorId,
        departmentId,
        appointmentDate: date,
        timeSlot: slots[0],
        appointmentType: "CONSULTATION",
        source: "WALK_IN",
        reason: "Admission flow E2E access fixture",
      },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    return (await created.json()).data.id as string
  }
  throw new Error("No future appointment slot was available to link the doctor to the test patient.")
}

async function openAdmissionModal(page: Page, session: Session, patient: PatientFixture, bedId: string, admissionType: string, reason: string, includeFinancialStep: boolean, depositAmount?: string) {
  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/ward")
  await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()
  await page.getByRole("button", { name: "Admit Patient" }).first().click()

  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox", { name: "Patient" }).fill(patient.mrNumber)
  await dialog.getByRole("option").filter({ hasText: patient.mrNumber }).click()
  await dialog.locator(`button[data-bed-id="${bedId}"]`).click()
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByLabel("Admission Type").selectOption({ label: admissionType })
  await dialog.getByLabel("Reason for Admission").fill(reason)

  if (includeFinancialStep) {
    await dialog.getByRole("button", { name: "Next" }).click()
    await expect(dialog.getByText("Financial & Notes", { exact: true })).toBeVisible()
    if (depositAmount) await dialog.getByLabel("Advance Deposit (PKR)").fill(depositAmount)
  } else {
    await expect(dialog.getByText("Financial & Notes", { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel("Admission notes")).toBeVisible()
  }

  await dialog.getByRole("button", { name: "Admit Patient" }).click()
  await expect(dialog.getByText("Admission Summary", { exact: true })).toBeVisible()
  return dialog
}

test("doctor admits in two steps without financial fields; receptionist admits with deposit in three", async ({ page, request }) => {
  test.setTimeout(120_000)
  const adminSession = await login(request, credentials.admin)
  const doctorSession = await login(request, credentials.doctor)
  const receptionistSession = await login(request, credentials.receptionist)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const patientFixtures: PatientFixture[] = []
  const appointmentIds: string[] = []

  try {
    const [doctorResponse, bedsResponse] = await Promise.all([
      request.get(`${apiBase}/appointments/doctors`, { headers: adminHeaders }),
      request.get(`${apiBase}/wards/beds/availability`, { headers: adminHeaders }),
    ])
    expect(doctorResponse.ok()).toBeTruthy()
    expect(bedsResponse.ok()).toBeTruthy()
    const doctors = (await doctorResponse.json()).data as Array<{ id: string; user: { name: string }; department: { id: string } }>
    const doctor = doctors.find((candidate) => candidate.user.name === "Dr. Ahmed Khan")
    const beds = ((await bedsResponse.json()).data as Array<{ id: string; status: string }>)
      .filter((bed) => bed.status === "AVAILABLE")
      .slice(0, 2)
    expect(doctor, "Seeded doctor must exist").toBeTruthy()
    expect(beds).toHaveLength(2)
    const suffix = Date.now().toString()
    const doctorPatient = await createPatient(request, adminHeaders, `${suffix}1`)
    patientFixtures.push(doctorPatient)
    appointmentIds.push(await linkDoctorPatient(request, adminHeaders, doctorPatient.id, doctor!.id, doctor!.department.id))
    const doctorReason = `Doctor two-step E2E ${suffix}`
    const doctorDialog = await openAdmissionModal(page, doctorSession, doctorPatient, beds[0].id, "Planned", doctorReason, false)
    await expect(doctorDialog.getByText("Deposit", { exact: true })).toHaveCount(0)
    await doctorDialog.getByRole("button", { name: "Done" }).click()
    await expect(page.locator(`button[data-bed-id="${beds[0].id}"]`)).toContainText("Deposit pending")

    const receptionistPatient = await createPatient(request, adminHeaders, `${suffix}2`)
    patientFixtures.push(receptionistPatient)
    const receptionistReason = `Reception three-step E2E ${suffix}`
    const receptionistDialog = await openAdmissionModal(page, receptionistSession, receptionistPatient, beds[1].id, "Planned", receptionistReason, true, "10000")
    await expect(receptionistDialog.getByText("Deposit", { exact: true })).toBeVisible()
    await receptionistDialog.getByRole("button", { name: "Done" }).click()
    await expect(page.locator(`button[data-bed-id="${beds[1].id}"]`)).not.toContainText("Deposit pending")

    const doctorAdmissionsResponse = await request.get(`${apiBase}/wards/admissions?limit=100&patientId=${doctorPatient.id}`, { headers: adminHeaders })
    const receptionistAdmissionsResponse = await request.get(`${apiBase}/wards/admissions?limit=100&patientId=${receptionistPatient.id}`, { headers: adminHeaders })
    expect(doctorAdmissionsResponse.ok()).toBeTruthy()
    expect(receptionistAdmissionsResponse.ok()).toBeTruthy()
    const doctorAdmission = ((await doctorAdmissionsResponse.json()).data as AdmissionFixture[]).find((item) => item.admissionReason === doctorReason)
    const receptionistAdmission = ((await receptionistAdmissionsResponse.json()).data as Array<AdmissionFixture & { depositAmount: string; depositStatus: string }>).find((item) => item.admissionReason === receptionistReason)
    expect(doctorAdmission).toBeTruthy()
    expect(receptionistAdmission).toEqual(expect.objectContaining({ depositAmount: "10000", depositStatus: "PAID" }))
  } finally {
    for (const patient of patientFixtures) {
      const admissionsResponse = await request.get(`${apiBase}/wards/admissions?limit=100&patientId=${patient.id}`, { headers: adminHeaders })
      if (admissionsResponse.ok()) {
        const admissions = (await admissionsResponse.json()).data as AdmissionFixture[]
        for (const admission of admissions.filter((item) => item.status === "ACTIVE")) {
          const discharged = await request.post(`${apiBase}/wards/admissions/${admission.id}/discharge`, {
            headers: adminHeaders,
            data: { diagnosis: "E2E cleanup", conditionAtDischarge: "Stable", instructions: "Test cleanup", confirmUnpaidBalance: true },
          })
          expect(discharged.ok(), await discharged.text()).toBeTruthy()
          const available = await request.patch(`${apiBase}/wards/beds/${admission.bedId}/status`, { headers: adminHeaders, data: { status: "AVAILABLE" } })
          expect(available.ok(), await available.text()).toBeTruthy()
        }
      }
      const deleted = await request.delete(`${apiBase}/patients/${patient.id}`, { headers: adminHeaders })
      expect(deleted.ok(), await deleted.text()).toBeTruthy()
    }
    for (const appointmentId of appointmentIds) {
      const cancelled = await request.post(`${apiBase}/appointments/${appointmentId}/cancel`, {
        headers: adminHeaders,
        data: { reason: "Admission E2E fixture cleanup" },
      })
      expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
    }
  }
})
