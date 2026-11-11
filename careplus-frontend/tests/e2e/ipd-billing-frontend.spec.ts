import { test, expect } from "@playwright/test"
import { admin, apiBase, login, openDashboard } from "./test-helpers"

type ApiResult<T> = { data: T }

test("IPD admission billing works end to end and restricts collection/refunds by role", async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const adminSession = await login(request, admin)
  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`

  const [bedsResponse, doctorsResponse] = await Promise.all([
    request.get(`${apiBase}/wards/beds/availability`, { headers: adminHeaders }),
    request.get(`${apiBase}/appointments/doctors`, { headers: adminHeaders }),
  ])
  expect(bedsResponse.ok(), await bedsResponse.text()).toBeTruthy()
  expect(doctorsResponse.ok(), await doctorsResponse.text()).toBeTruthy()
  const beds = (await bedsResponse.json() as ApiResult<Array<{ id: string; status: string }>>).data
  const doctors = (await doctorsResponse.json() as ApiResult<Array<{ id: string; user: { name: string } }>>).data
  const bed = beds.find((candidate) => candidate.status === "AVAILABLE")
  const doctor = doctors.find((candidate) => /ahmed/i.test(candidate.user.name))
  expect(bed, "careplus_test needs one available bed for the IPD E2E").toBeTruthy()
  expect(doctor, "careplus_test needs Dr. Ahmed for the IPD E2E").toBeTruthy()

  const patientResponse = await request.post(`${apiBase}/patients`, {
    headers: adminHeaders,
    data: {
      firstName: "IPD",
      lastName: `Billing${suffix}`,
      phone: `0300${suffix.slice(-7)}`,
      age: 36,
      gender: "MALE",
      address: "CarePlus test ward",
    },
  })
  expect(patientResponse.ok(), await patientResponse.text()).toBeTruthy()
  const patient = (await patientResponse.json() as ApiResult<{ id: string; mrNumber: string }>).data

  const chargeResponse = await request.post(`${apiBase}/wards/service-charges`, {
    headers: adminHeaders,
    data: { name: `E2E ward service ${suffix}`, category: "NURSING", defaultPrice: 125 },
  })
  expect(chargeResponse.ok(), await chargeResponse.text()).toBeTruthy()
  const charge = (await chargeResponse.json() as ApiResult<{ id: string }>).data

  const batchNumber = `E2E-${suffix}`
  const medicineResponse = await request.post(`${apiBase}/pharmacy/medicines`, {
    headers: adminHeaders,
    data: {
      name: `E2E ward medicine ${suffix}`,
      unitType: "TABLET",
      initialBatch: {
        batchNumber,
        expiryDate: "2030-12-31",
        purchasePrice: 4,
        sellingPrice: 8,
        stockQuantity: 10,
      },
    },
  })
  expect(medicineResponse.ok(), await medicineResponse.text()).toBeTruthy()
  const medicine = (await medicineResponse.json() as ApiResult<{ id: string }>).data

  const admissionResponse = await request.post(`${apiBase}/wards/admissions`, {
    headers: adminHeaders,
    data: {
      patientId: patient.id,
      bedId: bed!.id,
      attendingDoctorId: doctor!.id,
      admissionType: "PLANNED",
      admissionReason: "IPD billing E2E",
      depositAmount: 0,
    },
  })
  expect(admissionResponse.ok(), await admissionResponse.text()).toBeTruthy()
  const admission = (await admissionResponse.json() as ApiResult<{ id: string }>).data

  const nurseEmail = `ipd-nurse-${suffix}@careplus.local`
  const nurseResponse = await request.post(`${apiBase}/users`, {
    headers: adminHeaders,
    data: { name: "IPD E2E Nurse", email: nurseEmail, password: "Ward@12345", role: "NURSE" },
  })
  expect(nurseResponse.ok(), await nurseResponse.text()).toBeTruthy()
  const nurse = (await nurseResponse.json() as ApiResult<{ id: string }>).data
  let managerId: string | null = null
  const nurseSession = await login(request, { email: nurseEmail, password: "Ward@12345" })
  const nurseHeaders = { Authorization: `Bearer ${nurseSession.accessToken}` }
  const orderResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/medicine-orders`, {
    headers: nurseHeaders,
    data: { orderNote: "E2E ward dose", items: [{ medicineId: medicine.id, quantity: 2 }] },
  })
  expect(orderResponse.ok(), await orderResponse.text()).toBeTruthy()
  const order = (await orderResponse.json() as ApiResult<{ id: string }>).data

  try {
    const labTestsResponse = await request.get(`${apiBase}/lab/tests`, { headers: adminHeaders })
    expect(labTestsResponse.ok(), await labTestsResponse.text()).toBeTruthy()
    const labTests = (await labTestsResponse.json() as ApiResult<Array<{ id: string; isActive: boolean }>>).data
    const labTest = labTests.find((item) => item.isActive)
    expect(labTest, "careplus_test needs one active lab test for the IPD E2E").toBeTruthy()
    const labOrderResponse = await request.post(`${apiBase}/lab/orders`, {
      headers: adminHeaders,
      data: { patientId: patient.id, testId: labTest!.id, admissionId: admission.id },
    })
    expect(labOrderResponse.ok(), await labOrderResponse.text()).toBeTruthy()

    await openDashboard(page, adminSession, "/dashboard/pharmacy?section=work-items")
    await page.getByRole("tab", { name: "Issue to ward" }).click()
    await page.getByLabel("Active admission").selectOption(admission.id)
    await expect(page.getByText("E2E ward dose")).toBeVisible()
    await page.getByRole("button", { name: "Issue by FEFO" }).click()
    await expect(page.getByText(/FEFO batches:/)).toBeVisible()
    await expect(page.getByText(new RegExp(`FEFO batches: ${batchNumber}`))).toBeVisible()

    await page.goto(`/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await page.getByRole("tab", { name: "Billing" }).click()
    await expect(page.getByText(/IPD running bill/)).toBeVisible()
    await expect(page.getByText(`E2E ward medicine ${suffix}`)).toBeVisible()
    const serviceSection = page.getByRole("heading", { name: "Services", exact: true }).locator("..")
    await expect(serviceSection.getByText("No services charges.")).toBeVisible()
    await page.getByLabel("Add service line").selectOption(charge.id)
    await page.getByRole("button", { name: "Add service" }).click()
    await expect(serviceSection.getByText(`E2E ward service ${suffix}`)).toBeVisible()
    await expect(page.getByText("Tests", { exact: true })).toBeVisible()

    await page.getByLabel("Transaction").selectOption("DEPOSIT")
    await page.getByLabel("Amount (PKR)").fill("1")
    await page.getByRole("button", { name: "Record deposit" }).click()
    await expect(page.getByText(/Deposit paid \(net\)/)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Payments and refunds" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Refund payment" })).toBeVisible()

    await openDashboard(page, nurseSession, `/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await page.getByRole("tab", { name: "Billing" }).click()
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Record deposit" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Refund payment" })).toHaveCount(0)

    const doctorSession = await login(request, { email: "dr.ahmed@careplus.local", password: "Doctor@12345" })
    await openDashboard(page, doctorSession, `/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await page.getByRole("tab", { name: "Billing" }).click()
    await expect(page.getByRole("button", { name: "Add service" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Record deposit" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Refund payment" })).toHaveCount(0)

    await openDashboard(page, adminSession, `/dashboard/ward/round/${admission.id}`)
    await page.getByRole("button", { name: "Discharge", exact: true }).click()
    await page.getByRole("textbox", { name: "Diagnosis *", exact: true }).fill("IPD E2E diagnosis")
    await page.getByLabel("Condition at discharge").fill("Stable")
    await page.getByLabel("Patient instructions").fill("Follow the discharge plan.")
    await page.getByLabel("Override and discharge with balance pending").check()
    await page.getByPlaceholder("Mandatory reason for overriding unpaid balance").fill("Admin authorized override")
    await page.getByRole("button", { name: "Discharge Patient", exact: true }).click()
    await page.getByRole("button", { name: "Confirm Discharge" }).click()
    await expect(page.getByText("Final bill preview", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Collect balance and settle" }).click()
    await expect(page.getByText("Final bill settled")).toBeVisible()

    await page.goto(`/print/ipd-bill/${admission.id}?final=true`)
    await expect(page.getByTestId("print-data-ready")).toBeAttached()
    await expect(page.getByText("Final IPD Bill")).toBeVisible()

    let managerSession
    try {
      managerSession = await login(request, { email: "billing-manager@careplus.local", password: "Billing@12345" })
    } catch {
      const managerEmail = `ipd-billing-manager-${suffix}@careplus.local`
      const managerResponse = await request.post(`${apiBase}/users`, {
        headers: adminHeaders,
        data: { name: "IPD E2E Billing Manager", email: managerEmail, password: "Billing@12345", role: "BILLING_MANAGER" },
      })
      expect(managerResponse.ok(), await managerResponse.text()).toBeTruthy()
      managerId = (await managerResponse.json() as ApiResult<{ id: string }>).data.id
      managerSession = await login(request, { email: managerEmail, password: "Billing@12345" })
    }

    await openDashboard(page, managerSession, `/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await page.getByRole("tab", { name: "Admissions" }).click()
    await expect(page.getByRole("button", { name: "Refund payment" })).toBeVisible()
    await page.getByRole("button", { name: "Refund payment" }).click()
    await page.getByLabel("Refund amount (PKR)").fill("1")
    await page.getByLabel("Reason (required)").fill("IPD E2E refund permission check")
    await page.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(page.getByText(/Refund · CASH/)).toBeVisible()

    // RECEPTIONIST must not see refund or reversal buttons
    const receptionistSession = await login(request, { email: "reception@careplus.local", password: "Staff@12345" })
    await openDashboard(page, receptionistSession, `/dashboard/patients/${encodeURIComponent(patient.mrNumber)}`)
    await page.getByRole("tab", { name: "Admissions" }).click()
    await expect(page.getByRole("button", { name: "Refund payment" })).not.toBeVisible()
    await expect(page.getByRole("button", { name: "Reverse" })).not.toBeVisible()
    await expect(page.getByText("Correct or reverse a line")).not.toBeVisible()

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    await request.post(`${apiBase}/users/${nurse.id}/deactivate`, { headers: adminHeaders })
    if (managerId) await request.post(`${apiBase}/users/${managerId}/deactivate`, { headers: adminHeaders })
  }
})
