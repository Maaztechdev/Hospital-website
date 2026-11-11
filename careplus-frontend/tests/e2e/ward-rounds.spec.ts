import "../../../careplus-backend/tests/setupEnv"
import { PrismaClient } from "../../../careplus-backend/node_modules/@prisma/client/default.js"
import { expect, test } from "@playwright/test"
import { apiBase, login, openDashboard, ensureAvailableBeds } from "./test-helpers"

const prisma = new PrismaClient()
const doctorCredentials = { email: "dr.fatima@careplus.local", password: "Doctor@12345" }

test("doctor records a ward round, vitals and lab order, marks discharge readiness, and discharges", async ({ page, request }) => {
  test.setTimeout(120_000)
  const adminSession = await login(request)
  const doctorSession = await login(request, doctorCredentials)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let patientId: string | undefined
  let admissionId: string | undefined
  let bedId: string | undefined
  let testId: string | undefined

  try {
    const patientResponse = await request.post(`${apiBase}/patients`, {
      headers: adminHeaders,
      data: { firstName: "Ward Round", lastName: suffix, age: 46, gender: "OTHER", phone: `0300${Date.now().toString().slice(-7)}` },
    })
    expect(patientResponse.ok(), await patientResponse.text()).toBeTruthy()
    const patient = (await patientResponse.json()).data as { id: string; mrNumber: string; firstName: string; lastName: string }
    patientId = patient.id

    await ensureAvailableBeds(request, adminHeaders, 1)
    const [doctorsResponse, bedsResponse, testsResponse] = await Promise.all([
      request.get(`${apiBase}/appointments/doctors`, { headers: doctorHeaders }),
      request.get(`${apiBase}/wards/beds/availability`, { headers: adminHeaders }),
      request.get(`${apiBase}/lab/tests`, { headers: adminHeaders }),
    ])
    expect(doctorsResponse.ok(), await doctorsResponse.text()).toBeTruthy()
    expect(bedsResponse.ok(), await bedsResponse.text()).toBeTruthy()
    expect(testsResponse.ok(), await testsResponse.text()).toBeTruthy()
    const doctor = ((await doctorsResponse.json()).data as Array<{ id: string; userId: string }>).find((candidate) => candidate.userId === doctorSession.user.id)
    const bed = ((await bedsResponse.json()).data as Array<{ id: string; status: string }>).find((candidate) => candidate.status === "AVAILABLE")
    const labTest = ((await testsResponse.json()).data as Array<{ id: string; isActive: boolean }>).find((candidate) => candidate.isActive)
    expect(doctor, "the signed-in doctor must have a doctor profile").toBeTruthy()
    expect(bed, "an available bed is needed for this test").toBeTruthy()
    expect(labTest, "an active lab test is needed for this test").toBeTruthy()
    bedId = bed!.id
    testId = labTest!.id

    const admissionResponse = await request.post(`${apiBase}/wards/admissions`, {
      headers: doctorHeaders,
      data: {
        patientId: patient.id,
        bedId: bed!.id,
        attendingDoctorId: doctor!.id,
        admissionType: "PLANNED",
        admissionReason: `Ward round E2E ${suffix}`,
      },
    })
    expect(admissionResponse.ok(), await admissionResponse.text()).toBeTruthy()
    admissionId = (await admissionResponse.json()).data.id as string

    await openDashboard(page, doctorSession, `/dashboard/ward/round/${admissionId}`)
    await expect(page.getByRole("heading", { name: new RegExp(patient.firstName) })).toBeVisible()
    await page.getByLabel("Complaints / subjective").fill("Pain is improving")
    await page.getByLabel("Findings / examination").fill("Alert and comfortable")
    await page.getByLabel("Assessment / diagnosis update").fill("Recovering")
    await page.getByLabel("Plan").fill("Continue observation")
    await page.getByRole("button", { name: "Save round note" }).click()
    await expect(page.getByText("Pain is improving")).toBeVisible()
    await page.screenshot({ path: "../qa-evidence/doctor-round-ui.png", fullPage: true })

    await page.getByLabel("Pulse").fill("82")
    await page.getByLabel("SpO₂").fill("97")
    await page.getByRole("button", { name: "Record vitals" }).click()
    await expect(page.getByText("82 bpm")).toBeVisible()

    await page.getByLabel("Order lab").selectOption(testId!)
    await page.getByRole("button", { name: "Order lab" }).click()
    await expect(page.getByText("Lab ordered")).toBeVisible()

    await page.getByRole("button", { name: "Mark ready for discharge" }).click()
    await expect(page.getByRole("button", { name: "Remove discharge-ready" })).toBeVisible()
    await page.getByRole("button", { name: "Dashboard" }).click()
    const patientCard = page.locator("div.rounded-lg", { hasText: patient.mrNumber })
    await expect(patientCard.getByText("Done today", { exact: true })).toBeVisible()

    // Switch to Administrator to perform discharge with unpaid dues override
    await openDashboard(page, adminSession, `/dashboard/ward/round/${admissionId}`)
    await page.getByRole("button", { name: "Discharge", exact: true }).click()
    await page.locator("#discharge-diagnosis").fill("Recovered from acute illness")
    await page.locator("#discharge-condition").fill("Stable")
    await page.locator("#discharge-instructions").fill("Return for worsening symptoms.")
    const override = page.getByLabel("Override and discharge with balance pending")
    if (await override.isVisible()) {
      await override.check()
      const reasonInput = page.locator("#discharge-override-reason")
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Authorized medical discharge override by hospital administrator")
      }
    }
    await page.getByRole("button", { name: "Discharge Patient" }).click()
    await page.getByRole("button", { name: "Confirm Discharge" }).click()
    await expect(page.getByText(`${patient.firstName} ${patient.lastName} has been discharged`)).toBeVisible()
  } finally {
    if (bedId) {
      await prisma.bed.update({ where: { id: bedId }, data: { status: "AVAILABLE" } }).catch(() => {})
    }
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})
