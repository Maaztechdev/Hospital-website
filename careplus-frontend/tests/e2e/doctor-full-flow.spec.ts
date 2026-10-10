import "../../../careplus-backend/tests/setupEnv"
import { PrismaClient } from "../../../careplus-backend/node_modules/@prisma/client/default.js"
import { createHmac } from "node:crypto"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { apiBase, login, openDashboard } from "./test-helpers"

const prisma = new PrismaClient()
const adminCredentials = { email: "admin@careplus.local", password: "Admin@12345" }
const doctorCredentials = { email: "dr.ahmed@careplus.local", password: "Doctor@12345" }
const receptionistCredentials = { email: "reception@careplus.local", password: "Staff@12345" }
const passwordForTests = process.env.JWT_ACCESS_SECRET ?? "test_access_secret_min_32_characters_long"

type Session = Awaited<ReturnType<typeof login>>
type FixturePatient = { id: string; mrNumber: string; firstName: string; lastName: string }
type AppointmentFixture = { id: string; tokenNumber: number }

function hospitalDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)
}

function dateAtHospitalTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:00`)
}

async function apiJson<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as T
}

async function createPatient(request: APIRequestContext, headers: Record<string, string>, suffix: string, allergies: string[]): Promise<FixturePatient> {
  const response = await request.post(`${apiBase}/patients`, {
    headers,
    data: {
      firstName: "Full Flow",
      lastName: suffix,
      age: 42,
      gender: "OTHER",
      phone: `0300${Date.now().toString().slice(-7)}${suffix.slice(-1)}`,
      allergies,
      allergiesReviewed: true,
      chronicConditions: ["E2E chronic condition"],
      chronicConditionsReviewed: true,
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data as FixturePatient
}

async function createAppointmentsForToday(
  request: APIRequestContext,
  headers: Record<string, string>,
  doctor: { id: string; department: { id: string } },
  patientA: FixturePatient,
  patientB: FixturePatient,
  suffix: string,
  onCreated: (id: string) => void,
) {
  let targetDate = ""
  let slots: string[] = []
  for (let offset = 1; offset <= 45 && slots.length < 3; offset += 1) {
    const target = new Date(Date.now() + offset * 86_400_000)
    const date = hospitalDate(target)
    const response = await request.get(`${apiBase}/appointments/doctors/${doctor.id}/slots?date=${date}`, { headers })
    const data = await apiJson<{ availableSlots: string[] }>(response)
    if (data.availableSlots.length >= 3) {
      targetDate = date
      slots = data.availableSlots.slice(0, 3)
    }
  }
  expect(slots.length, "The doctor needs three API-bookable appointment slots to set up the full flow").toBe(3)

  const appointments: AppointmentFixture[] = []
  for (const [index, patient] of [patientA, patientB, patientB].entries()) {
    const response = await request.post(`${apiBase}/appointments`, {
      headers,
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        departmentId: doctor.department.id,
        appointmentDate: targetDate,
        timeSlot: slots[index],
        appointmentType: index === 2 ? "FOLLOW_UP" : "CONSULTATION",
        source: "WALK_IN",
        reason: `Doctor full flow ${index === 0 ? "A" : index === 1 ? "B" : "repeat"} ${suffix}`,
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const appointment = (await response.json()).data as AppointmentFixture
    appointments.push(appointment)
    onCreated(appointment.id)
  }

  const today = hospitalDate(new Date())
  const todayStart = new Date(`${today}T00:00:00.000Z`)
  const existing = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, appointmentDate: todayStart },
    select: { id: true, tokenNumber: true, status: true },
  })
  let token = existing.reduce((maximum, appointment) => Math.max(maximum, appointment.tokenNumber), 0) + 1
  for (const appointment of appointments) {
    appointment.tokenNumber = token
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { appointmentDate: todayStart, tokenNumber: token++ },
    })
  }
  return appointments
}

async function createShortLivedAccessToken(session: Session) {
  const encodedPayload = session.accessToken.split(".")[1]
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>
  delete payload.exp
  delete payload.iat
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const claims = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 8 })).toString("base64url")
  const signature = createHmac("sha256", passwordForTests).update(`${header}.${claims}`).digest("base64url")
  return `${header}.${claims}.${signature}`
}

async function assertPrintPopup(page: Page, buttonName: string, expectedText: string) {
  const popupPromise = page.waitForEvent("popup", { timeout: 15_000 })
  await page.getByRole("button", { name: buttonName }).click()
  const popup = await popupPromise
  await expect(popup.locator("body")).toContainText(expectedText, { timeout: 20_000 })
  await popup.waitForFunction(() => {
    const win = window as Window & { __printCallCount?: number; __printedText?: string }
    return win.__printCallCount === 1 && Boolean(win.__printedText?.trim())
  }, undefined, { timeout: 15_000 })
  const printedText = await popup.evaluate(() => (window as Window & { __printedText?: string }).__printedText ?? "")
  expect(printedText).toContain(expectedText)
  const brokenImages = await popup.locator("#careplus-print-root img").evaluateAll((images) =>
    images.filter((image) => !(image instanceof HTMLImageElement) || image.naturalWidth === 0).length,
  )
  expect(brokenImages).toBe(0)
  await popup.close()
}

test("doctor-full-flow: queue, consultations, prescription, ward, OT, discharge, profile, and session", async ({ page, request, context }) => {
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(15_000)
  const [adminSession, doctorSession, receptionistSession] = await Promise.all([
    login(request, adminCredentials),
    login(request, doctorCredentials),
    login(request, receptionistCredentials),
  ])
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
  const receptionistHeaders = { Authorization: `Bearer ${receptionistSession.accessToken}` }
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  let patientA: FixturePatient | undefined
  let patientB: FixturePatient | undefined
  let appointmentIds: string[] = []
  let originalQueueStatuses: Array<{ id: string; status: "CONFIRMED" | "WAITING" }> = []
  let admissionId: string | undefined
  let completedConsultationId: string | undefined

  try {
    const [doctors, beds, medicines, labTests, otRooms] = await Promise.all([
      apiJson<Array<{ id: string; userId: string; name: string; user: { name: string }; department: { id: string } }>>(await request.get(`${apiBase}/appointments/doctors`, { headers: adminHeaders })),
      apiJson<Array<{ id: string; status: string }>>(await request.get(`${apiBase}/wards/beds/availability`, { headers: adminHeaders })),
      apiJson<Array<{ id: string; name: string; strength: string | null; form: string | null; isActive: boolean }>>(await request.get(`${apiBase}/pharmacy/medicines?limit=200`, { headers: adminHeaders })),
      apiJson<Array<{ id: string; testName: string; isActive: boolean }>>(await request.get(`${apiBase}/lab/tests`, { headers: adminHeaders })),
      apiJson<Array<{ id: string; name: string }>>(await request.get(`${apiBase}/ot/rooms`, { headers: adminHeaders })),
    ])
    const doctor = doctors.find((item) => item.userId === doctorSession.user.id)
    const medicine = medicines.find((item) => item.name.toLowerCase().includes("panadol") && item.isActive !== false) ?? medicines.find((item) => item.isActive !== false)
    const labTest = labTests.find((item) => item.isActive)
    const availableBed = beds.find((item) => item.status === "AVAILABLE")
    const otRoom = otRooms.find((item) => ["OT-1", "OT-2", "OT-3"].includes(item.name))
    expect(doctor, "The signed-in doctor profile is required").toBeTruthy()
    expect(medicine, "The pharmacy medicine catalog must have at least one active medicine").toBeTruthy()
    expect(labTest, "The lab catalog must have at least one active test").toBeTruthy()
    expect(availableBed, "The clean test DB must have an available bed").toBeTruthy()
    expect(otRoom, "The test DB must have at least one standard OT room").toBeTruthy()

    patientA = await createPatient(request, adminHeaders, `A-${suffix}`, [])
    patientB = await createPatient(request, adminHeaders, `B-${suffix}`, ["Penicillin"])
    const todayStart = new Date(`${hospitalDate(new Date())}T00:00:00.000Z`)
    const existingQueue = await prisma.appointment.findMany({
      where: { doctorId: doctor!.id, appointmentDate: todayStart, status: { in: ["CONFIRMED", "WAITING"] } },
      select: { id: true, status: true },
    })
    originalQueueStatuses = existingQueue as typeof originalQueueStatuses
    if (existingQueue.length) {
      await prisma.appointment.updateMany({
        where: { id: { in: existingQueue.map((appointment) => appointment.id) } },
        data: { status: "COMPLETED" },
      })
    }
    const appointments = await createAppointmentsForToday(request, adminHeaders, doctor!, patientA, patientB, suffix, (id) => appointmentIds.push(id))

    await context.addInitScript(() => {
      Object.defineProperty(window, "__printCallCount", { configurable: true, writable: true, value: 0 })
      Object.defineProperty(window, "__printedText", { configurable: true, writable: true, value: "" })
      window.print = () => {
        const current = window as Window & { __printCallCount: number; __printedText: string }
        current.__printCallCount += 1
        current.__printedText = document.body.innerText
      }
    })
    await openDashboard(page, doctorSession, "/dashboard/doctor")
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible()
    await page.getByRole("button", { name: "Call next patient" }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/doctor/consultation/${appointments[0].id}`))
    await expect(page.getByRole("heading", { name: new RegExp(patientA.mrNumber) })).toBeVisible()

    async function addCatalogMedicine() {
      await page.getByRole("button", { name: "Add Medicine" }).click()
      await page.getByLabel("Medicine 1").fill(medicine!.name)
      await page.locator(`[data-medicine-id="${medicine!.id}"] button`).click()
      await expect(page.getByLabel("Dose")).toHaveValue("1")
      await expect(page.getByLabel("Duration")).toHaveValue("3")
      await expect(page.getByRole("button", { name: "Sign Prescription" })).toBeEnabled()
    }

    async function enterRequiredConsultationText(complaint: string, diagnosis: string) {
      await page.getByLabel("Chief Complaint").fill(complaint)
      await page.getByLabel("Diagnosis").fill(diagnosis)
    }

    async function completeSignedConsultation() {
      await page.getByRole("button", { name: "Complete Consultation" }).click()
      await page.getByRole("dialog").getByRole("button", { name: "Complete Consultation" }).click()
      await expect(page.getByText(/visit has been marked done/i)).toBeVisible()
    }

    await enterRequiredConsultationText("Full flow patient A complaint", "Full flow patient A diagnosis")
    await addCatalogMedicine()
    await page.getByRole("button", { name: "Sign Prescription" }).click()
    await expect(page.getByText("Prescription signed", { exact: true })).toBeVisible()
    await completeSignedConsultation()
    const aConsultations = await apiJson<Array<{ id: string; bpSystolic: number | null; pulse: number | null; oxygenSaturation: number | null }>>(
      await request.get(`${apiBase}/consultations?appointmentId=${appointments[0].id}`, { headers: doctorHeaders }),
    )
    expect(aConsultations).toHaveLength(1)
    expect(aConsultations[0]).toMatchObject({ bpSystolic: null, pulse: null, oxygenSaturation: null })

    await page.goto("/dashboard/doctor")
    await page.getByRole("button", { name: "Call next patient" }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/doctor/consultation/${appointments[1].id}`))
    await expect(page.getByText("Penicillin", { exact: true }).first()).toBeVisible()
    await enterRequiredConsultationText("Full flow patient B complaint", "Full flow patient B diagnosis")
    await page.getByLabel("SpO2 (%)").fill("66")
    await expect(page.getByRole("alert").getByText("Critical value: SpO2 66%")).toBeVisible()
    await expect(page.getByLabel("I confirm these values are correct")).toBeVisible()
    await page.getByLabel("I confirm these values are correct").check()

    await expect(page.getByText("Suggest Lab Tests", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: labTest!.testName, exact: true })).toBeVisible()
    await page.getByRole("button", { name: labTest!.testName, exact: true }).click()
    await page.getByRole("button", { name: "KUB", exact: true }).click()
    await addCatalogMedicine()
    await page.getByRole("button", { name: "Sign Prescription" }).click()
    await expect(page.getByText("Prescription signed", { exact: true })).toBeVisible()
    await completeSignedConsultation()

    const consultationResponse = await request.get(`${apiBase}/consultations?appointmentId=${appointments[1].id}`, { headers: doctorHeaders })
    const consultationRows = await apiJson<Array<{ id: string; isCritical: boolean; criticalConfirmed: boolean }>>(consultationResponse)
    expect(consultationRows).toHaveLength(1)
    completedConsultationId = consultationRows[0].id
    expect(consultationRows[0]).toMatchObject({ isCritical: true, criticalConfirmed: true })
    const prescriptionRows = await apiJson<Array<{ id: string; consultationId: string; items: Array<{ medicineId: string | null; doseAmount: number; durationValue: number; durationUnit: string }> }>>(
      await request.get(`${apiBase}/prescriptions?limit=100`, { headers: doctorHeaders }),
    )
    const signedPrescription = prescriptionRows.find((item) => item.consultationId === completedConsultationId)
    expect(signedPrescription?.items[0]).toMatchObject({ medicineId: medicine!.id, doseAmount: 1, durationValue: 3, durationUnit: "days" })

    await page.goto(`/dashboard/doctor/consultation-record/${completedConsultationId}`)
    await expect(page.getByRole("heading", { name: "Consultation Record" })).toBeVisible()
    await expect(page.getByText("Signed · Locked")).toBeVisible()
    await expect(page.getByText("Critical vitals")).toBeVisible()
    await page.getByLabel("Add an addendum").fill("Doctor full-flow addendum")
    await page.getByRole("button", { name: "Add Addendum" }).click()
    await expect(page.getByText("Doctor full-flow addendum")).toBeVisible()
    await assertPrintPopup(page, "Print Prescription", medicine!.name)

    await page.goto("/dashboard/doctor")
    await page.getByRole("button", { name: "Call next patient" }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/doctor/consultation/${appointments[2].id}`))
    await expect(page.getByText("Patient Summary", { exact: true })).toBeVisible()
    await expect(page.getByText("Penicillin", { exact: true }).first()).toBeVisible()
    const previousMedicines = page.locator("details").filter({ hasText: "Previous medicines" })
    await previousMedicines.locator("summary").click()
    await expect(previousMedicines.getByText(medicine!.name, { exact: false }).first()).toBeVisible()
    await previousMedicines.getByRole("button", { name: "Repeat last prescription" }).click()
    await expect(page.getByRole("combobox", { name: "Medicine 1" })).toHaveValue(new RegExp(medicine!.name))
    const previousTests = page.locator("details").filter({ hasText: "Recent labs & ultrasounds" })
    await previousTests.locator("summary").click()
    await expect(previousTests.getByText(labTest!.testName, { exact: false })).toBeVisible()
    await expect(previousTests.getByText("KUB", { exact: false })).toBeVisible()

    await page.goto("/dashboard/ward")
    await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()
    await page.getByRole("button", { name: "Admit Patient" }).first().click()
    const admissionDialog = page.getByRole("dialog")
    await admissionDialog.getByRole("combobox", { name: "Patient" }).fill(patientB.mrNumber)
    await admissionDialog.getByRole("option").filter({ hasText: patientB.mrNumber }).click()
    await admissionDialog.locator(`button[data-bed-id="${availableBed!.id}"]`).click()
    await admissionDialog.getByRole("button", { name: "Next" }).click()
    await expect(admissionDialog.getByText("Financial & Notes", { exact: true })).toHaveCount(0)
    await admissionDialog.getByLabel("Admission Type").selectOption({ label: "Planned" })
    await admissionDialog.getByLabel("Reason for Admission").fill(`Doctor full-flow admission ${suffix}`)
    await admissionDialog.getByLabel("Admission notes").fill("Clinical admission notes from the doctor.")
    await admissionDialog.getByRole("button", { name: "Admit Patient" }).click()
    await expect(admissionDialog.getByText("Admission Summary", { exact: true })).toBeVisible()
    await expect(admissionDialog.getByText("Deposit", { exact: true })).toHaveCount(0)
    await admissionDialog.getByRole("button", { name: "Done" }).click()

    const admissionRows = await apiJson<Array<{ id: string; status: string; depositStatus: string }>>(
      await request.get(`${apiBase}/wards/admissions?limit=100&patientId=${patientB.id}`, { headers: doctorHeaders }),
    )
    const admission = admissionRows.find((item) => item.status === "ACTIVE")
    expect(admission).toBeTruthy()
    admissionId = admission!.id
    expect(admission!.depositStatus).toBe("PENDING")
    await expect(page.locator(`button[data-bed-id="${availableBed!.id}"]`)).toContainText("Deposit pending")

    await page.goto(`/dashboard/ward/round/${admissionId}`)
    await expect(page.getByRole("heading", { name: new RegExp(patientB.firstName) })).toBeVisible()
    await page.getByLabel("Complaints / subjective").fill("Ward round patient reports improvement.")
    await page.getByLabel("Findings / examination").fill("Stable on examination.")
    await page.getByRole("button", { name: "Save round note" }).click()
    await expect(page.getByText("Ward round patient reports improvement.")).toBeVisible()

    const depositResponse = await request.post(`${apiBase}/wards/admissions/${admissionId}/deposits`, {
      headers: receptionistHeaders,
      data: { amount: 10_000, paymentMethod: "CASH", notes: "Doctor full-flow E2E advance deposit" },
    })
    expect(depositResponse.ok(), await depositResponse.text()).toBeTruthy()
    const admissionAfterDeposit = await apiJson<{ outstandingBalance: number | string }>(
      await request.get(`${apiBase}/wards/admissions/${admissionId}`, { headers: doctorHeaders }),
    )
    expect(Number(admissionAfterDeposit.outstandingBalance)).toBe(-10_000)

    await page.goto("/dashboard/ot")
    await expect(page.getByRole("heading", { name: "Operation Theatre" })).toBeVisible()
    const tomorrow = hospitalDate(new Date(Date.now() + 86_400_000))
    await page.getByRole("button", { name: "Schedule Surgery" }).click()
    const surgeryDialog = page.getByRole("dialog", { name: "Schedule Surgery" })
    await expect(surgeryDialog.getByRole("alert")).toHaveCount(0)
    await surgeryDialog.getByPlaceholder("e.g. MR-2026-000101").fill(patientB.mrNumber)
    await surgeryDialog.getByPlaceholder("Search or enter a procedure").fill(`Full flow tomorrow ${suffix}`)
    await surgeryDialog.getByRole("tab", { name: "Doctor & Timing" }).click()
    await surgeryDialog.getByRole("combobox").nth(2).selectOption("General")
    await surgeryDialog.locator('input[type="date"]').fill(tomorrow)
    await expect(surgeryDialog.getByRole("alert")).toHaveCount(0)
    await expect(surgeryDialog.getByText("Free — this time is available.")).toBeVisible({ timeout: 15_000 })
    await surgeryDialog.getByRole("tab", { name: "Notes" }).click()
    await expect(surgeryDialog.getByRole("alert")).toHaveCount(0)
    await surgeryDialog.getByRole("button", { name: "Schedule Surgery" }).click()
    const scheduleConfirmation = page.getByRole("dialog").last()
    await scheduleConfirmation.getByRole("button", { name: "Schedule" }).click()
    await expect(page.getByText("Surgery scheduled", { exact: true })).toBeVisible()
    const futureSurgery = await prisma.surgery.findFirst({ where: { patientId: patientB.id, surgeryType: `Full flow tomorrow ${suffix}` } })
    expect(futureSurgery).toBeTruthy()

    const sameDayStart = dateAtHospitalTime(hospitalDate(new Date()), "09:00")
    await prisma.surgery.create({
      data: {
        patientId: patientB.id,
        otRoomId: otRoom!.id,
        surgeryType: `Full flow same day ${suffix}`,
        anesthesiaType: "General",
        surgeonId: doctor!.id,
        scheduledStart: sameDayStart,
        scheduledEnd: new Date(sameDayStart.getTime() + 60 * 60_000),
        createdBy: doctorSession.user.id,
      },
    })
    await page.goto("/dashboard/ot")
    await expect(page.getByRole("heading", { name: "Operation Theatre" })).toBeVisible()
    const sameDayCard = page.getByRole("button", { name: new RegExp(`Full flow same day ${suffix}`) })
    await expect(sameDayCard).toBeVisible()
    await sameDayCard.click()
    const surgeryDetails = page.getByRole("dialog", { name: "Surgery details" })
    for (const label of ["Consent signed", "NPO confirmed", "Labs done", "Blood arranged"]) {
      const checkbox = surgeryDetails.getByRole("checkbox", { name: label })
      if (!(await checkbox.isChecked())) {
        await checkbox.click()
        await expect(checkbox).toBeChecked()
      }
    }
    await surgeryDetails.getByRole("button", { name: "Start Pre-op" }).click()
    await expect(surgeryDetails.getByText("Pre-op", { exact: true }).first()).toBeVisible()
    await surgeryDetails.getByRole("button", { name: "Start Surgery" }).click()
    await expect(surgeryDetails.getByText("In Progress", { exact: true }).first()).toBeVisible()
    await surgeryDetails.getByLabel("Intra-operative notes").fill("No intra-operative complications.")
    await surgeryDetails.getByLabel("Outcome notes").fill("Patient stable.")
    await surgeryDetails.getByRole("button", { name: "Move to Recovery" }).first().click()
    await surgeryDetails.getByRole("button", { name: "Move to Recovery" }).last().click()
    await expect(surgeryDetails.getByText("Recovery", { exact: true }).first()).toBeVisible()
    await surgeryDetails.getByLabel("Post-op notes (required)").fill("Transferred to recovery in stable condition.")
    await surgeryDetails.getByRole("button", { name: "Complete" }).first().click()
    await surgeryDetails.getByRole("button", { name: "Complete" }).last().click()
    await expect(surgeryDetails.getByText("Completed", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Completed Today", { exact: true })).toBeVisible()
    await surgeryDetails.getByRole("button", { name: "Close", exact: true }).click()

    await page.goto(`/dashboard/ward/round/${admissionId}`)
    await page.getByRole("button", { name: "Discharge", exact: true }).click()
    await page.locator("#discharge-diagnosis").fill("Full flow discharge diagnosis")
    await page.locator("#discharge-course").fill("Treatment completed and patient improved.")
    await page.locator("#discharge-medications").fill(`${medicine!.name} 1 tablet daily for 3 days`)
    await page.locator("#discharge-condition").fill("Stable for discharge.")
    await page.locator("#discharge-followup-date").fill(tomorrow)
    await page.locator("#discharge-referral").fill("Outpatient follow-up")
    await page.locator("#discharge-instructions").fill("Take medicine as prescribed and return if symptoms worsen.")
    const balanceWarning = page.getByText(/Outstanding balance:/)
    await expect(balanceWarning).toHaveCount(0)
    const dischargeButton = page.getByRole("button", { name: "Discharge Patient" })
    await expect(dischargeButton).toBeEnabled()
    await dischargeButton.click()
    await page.getByRole("dialog").getByRole("button", { name: "Confirm Discharge" }).click()
    await expect(page.getByText(`${patientB.firstName} ${patientB.lastName} has been discharged`)).toBeVisible()
    await assertPrintPopup(page, "Print Discharge Summary", "Full flow discharge diagnosis")

    await page.goto(`/dashboard/patients/${patientB.mrNumber}`)
    await expect(page.getByRole("heading", { name: `${patientB.firstName} ${patientB.lastName}` })).toBeVisible()
    const tabs = ["Overview", "Timeline", "Visits", "Prescriptions", "Lab Reports", "Ultrasound History", "Pharmacy", "Billing", "Admissions", "OT"]
    for (const name of tabs) {
      await page.getByRole("tab", { name, exact: true }).click()
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")
    }
    await page.getByRole("tab", { name: "Visits", exact: true }).click()
    await expect(page.getByText(`Token #${appointments[1].tokenNumber}`)).toBeVisible()
    await expect(page.getByText(`Token #${appointments[2].tokenNumber}`)).toBeVisible()
    await expect(page.getByText(`Token #${appointments[0].tokenNumber}`)).toHaveCount(0)
    await page.getByRole("tab", { name: "Prescriptions", exact: true }).click()
    await expect(page.getByText(medicine!.name, { exact: false }).first()).toBeVisible()
    await page.getByRole("tab", { name: "Lab Reports", exact: true }).click()
    await expect(page.getByText(labTest!.testName, { exact: false })).toBeVisible()
    await page.getByRole("tab", { name: "Ultrasound History", exact: true }).click()
    await expect(page.getByText("KUB", { exact: false })).toBeVisible()
    await page.getByRole("tab", { name: "Billing", exact: true }).click()
    await expect(page.getByText(/Advance deposit.*10,000/i)).toBeVisible()
    await page.getByRole("tab", { name: "Admissions", exact: true }).click()
    await expect(page.getByText("DISCHARGED", { exact: true })).toBeVisible()
    await page.getByRole("tab", { name: "OT", exact: true }).click()
    await expect(page.getByText(`Full flow same day ${suffix}`, { exact: false })).toBeVisible()
    await expect(page.getByText(`Full flow tomorrow ${suffix}`, { exact: false })).toBeVisible()

    await page.addInitScript(() => {
      Object.defineProperty(window, "__CAREPLUS_SESSION_CONFIG__", {
        configurable: true,
        value: { warningLeadMs: 3_000, inactivityTimeoutMs: 1_500 },
      })
    })
    await page.goto("/dashboard/doctor")
    const expiringSession = await login(request, doctorCredentials)
    const expiringAccessToken = await createShortLivedAccessToken(expiringSession)
    await page.evaluate((session) => {
      sessionStorage.setItem("careplus.accessToken", session.accessToken)
      sessionStorage.setItem("careplus.refreshToken", session.refreshToken)
      window.dispatchEvent(new Event("careplus:activity"))
    }, { accessToken: expiringAccessToken, refreshToken: expiringSession.refreshToken })
    const warning = page.getByText("Your session will expire soon. Stay signed in to continue working.", { exact: true })
    await expect(warning).toBeVisible({ timeout: 8_000 })
    await expect(warning).toHaveCount(1)
    await page.getByRole("button", { name: "Stay signed in" }).click()
    await expect(warning).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard\/doctor$/)
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("careplus.accessToken"))).not.toBe(expiringAccessToken)
    await page.waitForTimeout(500)
    await expect(warning).toHaveCount(0)
    await expect(warning).toBeVisible({ timeout: 4_000 })
  } finally {
    const patientIds = [patientA?.id, patientB?.id].filter((id): id is string => Boolean(id))
    await prisma.$transaction(async (tx) => {
      const consultations = await tx.consultation.findMany({ where: { patientId: { in: patientIds } }, select: { id: true, appointmentId: true } })
      const consultationIds = consultations.map((item) => item.id)
      const admissions = await tx.admission.findMany({ where: { patientId: { in: patientIds } }, select: { id: true, bedId: true } })
      const admissionIds = admissions.map((item) => item.id)
      const labOrders = await tx.labOrder.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } })
      const labOrderIds = labOrders.map((item) => item.id)
      const ultrasoundOrders = await tx.ultrasoundOrder.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } })
      const ultrasoundOrderIds = ultrasoundOrders.map((item) => item.id)
      const surgeries = await tx.surgery.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } })
      const surgeryIds = surgeries.map((item) => item.id)
      const prescriptions = await tx.prescription.findMany({ where: { consultationId: { in: consultationIds } }, select: { id: true } })
      const prescriptionIds = prescriptions.map((item) => item.id)
      const allEntityIds = [
        ...patientIds, ...appointmentIds, ...consultationIds, ...admissionIds, ...labOrderIds,
        ...ultrasoundOrderIds, ...surgeryIds, ...prescriptionIds,
      ]

      if (allEntityIds.length) {
        await tx.notification.deleteMany({ where: { relatedEntityId: { in: allEntityIds } } })
        await tx.auditLog.deleteMany({ where: { entityId: { in: allEntityIds } } })
      }
      if (surgeryIds.length) await tx.surgery.deleteMany({ where: { id: { in: surgeryIds } } })
      if (prescriptionIds.length) await tx.prescriptionShare.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } })
      if (prescriptionIds.length) await tx.prescription.deleteMany({ where: { id: { in: prescriptionIds } } })
      if (labOrderIds.length) {
        await tx.labResult.deleteMany({ where: { labOrderId: { in: labOrderIds } } })
        await tx.labReportAttachment.deleteMany({ where: { labOrderId: { in: labOrderIds } } })
        await tx.labOrder.deleteMany({ where: { id: { in: labOrderIds } } })
      }
      if (ultrasoundOrderIds.length) await tx.ultrasoundOrder.deleteMany({ where: { id: { in: ultrasoundOrderIds } } })
      if (consultationIds.length) await tx.consultationAddendum.deleteMany({ where: { consultationId: { in: consultationIds } } })
      if (consultationIds.length) await tx.consultation.deleteMany({ where: { id: { in: consultationIds } } })
      if (admissionIds.length) {
        await tx.patientLedgerEntry.deleteMany({ where: { admissionId: { in: admissionIds } } })
        await tx.patientVitals.deleteMany({ where: { admissionId: { in: admissionIds } } })
        await tx.wardRound.deleteMany({ where: { admissionId: { in: admissionIds } } })
        await tx.nursingTask.deleteMany({ where: { admissionId: { in: admissionIds } } })
        await tx.bedTransfer.deleteMany({ where: { admissionId: { in: admissionIds } } })
        await tx.admission.deleteMany({ where: { id: { in: admissionIds } } })
        await tx.bed.updateMany({ where: { id: { in: admissions.map((item) => item.bedId) } }, data: { status: "AVAILABLE" } })
      }
      if (appointmentIds.length) await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } })
      if (patientIds.length) await tx.patient.deleteMany({ where: { id: { in: patientIds } } })
    }, { maxWait: 10_000, timeout: 60_000 })
    for (const appointment of originalQueueStatuses) {
      await prisma.appointment.update({ where: { id: appointment.id }, data: { status: appointment.status } })
    }
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})
