import { test, expect, type APIRequestContext } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"
const admin = { email: "admin@careplus.local", password: "Admin@12345" }

async function apiLogin(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/auth/login`, { data: admin })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data as { accessToken: string; refreshToken: string }
}

async function expectBedState(page: import("@playwright/test").Page, bedId: string, status: string) {
  const tile = page.locator(`button[data-bed-id="${bedId}"]`)
  await expect(tile).toContainText(status)
}

async function findOrCreateAvailablePatient(request: APIRequestContext, headers: Record<string, string>) {
  const [patientsResponse, admissionsResponse] = await Promise.all([
    request.get(`${apiBase}/patients?limit=100`, { headers }),
    request.get(`${apiBase}/wards/admissions?limit=100&status=ACTIVE`, { headers }),
  ])
  expect(patientsResponse.ok()).toBeTruthy()
  expect(admissionsResponse.ok()).toBeTruthy()
  const admissions = (await admissionsResponse.json()).data as Array<{ id: string; patientId: string; admissionReason: string }>
  for (const admission of admissions.filter((candidate) => candidate.admissionReason === "Ward round-trip test")) {
    const dischargeResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/discharge`, {
      headers,
      data: {
        diagnosis: "Ward E2E cleanup",
        conditionAtDischarge: "Stable",
        instructions: "Test cleanup.",
      },
    })
    expect(dischargeResponse.ok(), await dischargeResponse.text()).toBeTruthy()
  }
  const activePatientIds = new Set(admissions.filter((admission) => admission.admissionReason !== "Ward round-trip test").map((admission) => admission.patientId))
  const patient = (await patientsResponse.json()).data.find((candidate: { id: string }) => !activePatientIds.has(candidate.id))
  if (patient) return patient

  const suffix = Date.now().toString().slice(-8)
  const response = await request.post(`${apiBase}/patients`, {
    headers,
    data: { firstName: "Ward E2E", lastName: suffix, age: 30, gender: "MALE", phone: `0300${suffix}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).data
}

async function readBedCounts(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get(`${apiBase}/wards/beds/availability`, { headers })
  expect(response.ok()).toBeTruthy()
  const beds = (await response.json()).data as Array<{ status: string }>
  const count = (status: string) => beds.filter((bed) => bed.status === status).length
  return {
    total: beds.length,
    occupied: count("OCCUPIED"),
    available: count("AVAILABLE"),
    cleaning: count("CLEANING"),
    maintenance: count("MAINTENANCE"),
    occupancy: beds.length ? Math.round((count("OCCUPIED") / beds.length) * 100) : 0,
  }
}

async function expectBedCounts(page: import("@playwright/test").Page, counts: Awaited<ReturnType<typeof readBedCounts>>) {
  for (const [label, value] of [
    ["Occupied", counts.occupied],
    ["Available", counts.available],
    ["Cleaning", counts.cleaning],
    ["Occupancy", `${counts.occupancy}%`],
  ] as const) {
    const card = page.getByText(label, { exact: true }).first().locator("xpath=../..")
    await expect(card.locator("span.cp-tabular")).toHaveText(String(value))
  }
}

test("ward admission transfer and discharge persist after reload", async ({ page, request }) => {
  test.setTimeout(90000)
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const [patient, doctorsResponse, bedsResponse] = await Promise.all([
    findOrCreateAvailablePatient(request, headers),
    request.get(`${apiBase}/appointments/doctors`, { headers }),
    request.get(`${apiBase}/wards/beds/availability`, { headers }),
  ])
  expect(doctorsResponse.ok()).toBeTruthy()
  expect(bedsResponse.ok()).toBeTruthy()

  const doctor = (await doctorsResponse.json()).data[0]
  const availableBeds = (await bedsResponse.json()).data.filter((bed: { status: string }) => bed.status === "AVAILABLE")
  expect(patient).toBeTruthy()
  expect(doctor).toBeTruthy()
  expect(availableBeds.length).toBeGreaterThanOrEqual(2)
  const firstBed = availableBeds[0] as { id: string; bedNumber: string }
  const secondBed = availableBeds[1] as { id: string; bedNumber: string }

  await page.goto("/dashboard/login")
  await page.evaluate((tokens) => {
    sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
  }, session)
  await page.goto("/dashboard/ward")
  await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()

  const admissionResponse = await request.post(`${apiBase}/wards/admissions`, {
    headers,
    data: { patientId: patient.id, bedId: firstBed.id, attendingDoctorId: doctor.id, admissionType: "PLANNED", admissionReason: "Ward round-trip test", depositAmount: 1 },
  })
  expect(admissionResponse.ok()).toBeTruthy()
  const admission = (await admissionResponse.json()).data as { id: string }
  await page.reload()
  await expectBedState(page, firstBed.id, "Occupied")

  const transferResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/transfer`, { headers, data: { toBedId: secondBed.id, reason: "Ward round-trip transfer" } })
  expect(transferResponse.ok()).toBeTruthy()
  await page.reload()
  await expectBedState(page, secondBed.id, "Occupied")
  await expectBedState(page, firstBed.id, "Available")

  const dischargeResponse = await request.post(`${apiBase}/wards/admissions/${admission.id}/discharge`, {
    headers,
    data: {
      diagnosis: "Ward round-trip diagnosis",
      conditionAtDischarge: "Stable",
      instructions: "Follow the discharge plan.",
    },
  })
  expect(dischargeResponse.ok()).toBeTruthy()
  await page.reload()
  await expectBedState(page, secondBed.id, "Cleaning")
  const cleaningCard = page.locator(`[data-bed-id="${secondBed.id}"]`).first()
  await cleaningCard.getByRole("button", { name: "Mark as Available" }).click()
  await expectBedState(page, secondBed.id, "Available")
})

test("cleaning bed can be made available, admitted, and reflected in dashboard counts", async ({ page, request }) => {
  test.setTimeout(90000)
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const [patient, doctorsResponse, bedsResponse] = await Promise.all([
    findOrCreateAvailablePatient(request, headers),
    request.get(`${apiBase}/appointments/doctors`, { headers }),
    request.get(`${apiBase}/wards/beds/availability`, { headers }),
  ])
  expect(doctorsResponse.ok()).toBeTruthy()
  expect(bedsResponse.ok()).toBeTruthy()

  const doctor = (await doctorsResponse.json()).data[0]
  const bedRows = (await bedsResponse.json()).data as Array<{ id: string; bedNumber: string; status: string; dailyRate: number | string }>
  const targetBed = bedRows.find((bed) => bed.status === "CLEANING") ?? bedRows.find((bed) => bed.status === "AVAILABLE")
  expect(patient).toBeTruthy()
  expect(doctor).toBeTruthy()
  expect(targetBed).toBeTruthy()

  const originalStatus = targetBed!.status
  let admissionId: string | undefined
  try {
    if (originalStatus === "AVAILABLE") {
      const cleaningResponse = await request.patch(`${apiBase}/wards/beds/${targetBed!.id}/status`, { headers, data: { status: "CLEANING" } })
      expect(cleaningResponse.ok(), await cleaningResponse.text()).toBeTruthy()
    }
    const before = await readBedCounts(request, headers)
    await page.goto("/dashboard/login")
    await page.evaluate((tokens) => {
      sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
      sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
    }, session)
    await page.goto("/dashboard/ward")
    await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()
    await expectBedCounts(page, before)

    const cleaningCard = page.locator(`[data-bed-id="${targetBed!.id}"]`).first()
    await cleaningCard.getByRole("button", { name: "Mark as Available" }).click()
    await expectBedState(page, targetBed!.id, "Available")
    const afterCleaning = await readBedCounts(request, headers)
    expect(afterCleaning.available).toBe(before.available + 1)
    expect(afterCleaning.cleaning).toBe(before.cleaning - 1)
    await expectBedCounts(page, afterCleaning)

    const auditResponse = await request.get(`${apiBase}/audit-logs?module=wards&entityType=Bed&entityId=${targetBed!.id}&limit=10`, { headers })
    expect(auditResponse.ok(), await auditResponse.text()).toBeTruthy()
    const bedAudit = (await auditResponse.json()).data as Array<{ entityId: string; action: string }>
    expect(bedAudit.some((entry) => entry.entityId === targetBed!.id && entry.action === "UPDATE")).toBeTruthy()

    const rateOverride = Number(targetBed!.dailyRate) + 100
    const admissionResponse = await request.post(`${apiBase}/wards/admissions`, {
      headers,
      data: {
        patientId: patient.id,
        bedId: targetBed!.id,
        attendingDoctorId: doctor.id,
        admissionType: "PLANNED",
        admissionReason: "Cleaning-bed admission E2E",
        depositAmount: 1000,
        dailyRate: rateOverride,
      },
    })
    expect(admissionResponse.ok(), await admissionResponse.text()).toBeTruthy()
    admissionId = (await admissionResponse.json()).data.id

    const activeAdmissionsResponse = await request.get(`${apiBase}/wards/admissions?limit=100&status=ACTIVE`, { headers })
    expect(activeAdmissionsResponse.ok()).toBeTruthy()
    const createdAdmission = (await activeAdmissionsResponse.json()).data.find((admission: { patientId: string; bedId: string }) => admission.patientId === patient.id && admission.bedId === targetBed!.id)
    expect(createdAdmission).toBeTruthy()
    expect(Number(createdAdmission.dailyRate)).toBe(rateOverride)

    await page.reload()
    await expectBedState(page, targetBed!.id, "Occupied")
    const afterAdmission = await readBedCounts(request, headers)
    expect(afterAdmission.occupied).toBe(afterCleaning.occupied + 1)
    expect(afterAdmission.available).toBe(afterCleaning.available - 1)
    await expectBedCounts(page, afterAdmission)
  } finally {
    if (admissionId) {
      const dischargeResponse = await request.post(`${apiBase}/wards/admissions/${admissionId}/discharge`, {
        headers,
        data: {
          diagnosis: "Ward daily-rate cleanup",
          conditionAtDischarge: "Stable",
          instructions: "Test cleanup.",
        },
      })
      expect(dischargeResponse.ok(), await dischargeResponse.text()).toBeTruthy()
    }
    if (originalStatus === "AVAILABLE") {
      const restoreResponse = await request.patch(`${apiBase}/wards/beds/${targetBed!.id}/status`, { headers, data: { status: "AVAILABLE" } })
      expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy()
    } else {
      const restoreResponse = await request.patch(`${apiBase}/wards/beds/${targetBed!.id}/status`, { headers, data: { status: "CLEANING" } })
      expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy()
    }
  }
})

test("admission empty state explains unavailable beds and offers the cleaning shortcut", async ({ page, request }) => {
  const session = await apiLogin(request)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const bedsResponse = await request.get(`${apiBase}/wards/beds/availability`, { headers })
  expect(bedsResponse.ok()).toBeTruthy()
  const startingBeds = (await bedsResponse.json()).data as Array<{ id: string; status: string }>
  const availableBeds = startingBeds.filter((bed) => bed.status === "AVAILABLE")
  const cleaningBeds = startingBeds.filter((bed) => bed.status === "CLEANING")
  const maintenanceCount = startingBeds.filter((bed) => bed.status === "MAINTENANCE").length
  expect(availableBeds.length).toBeGreaterThan(0)
  expect(cleaningBeds.length + availableBeds.length).toBeGreaterThan(0)

  try {
    for (const bed of availableBeds) {
      const response = await request.patch(`${apiBase}/wards/beds/${bed.id}/status`, { headers, data: { status: "CLEANING" } })
      expect(response.ok(), await response.text()).toBeTruthy()
    }

    await page.goto("/dashboard/login")
    await page.evaluate((tokens) => {
      sessionStorage.setItem("careplus.accessToken", tokens.accessToken)
      sessionStorage.setItem("careplus.refreshToken", tokens.refreshToken)
    }, session)
    await page.goto("/dashboard/ward")
    await expect(page.getByRole("heading", { name: "Ward & Bed Management" })).toBeVisible()
    await page.getByRole("button", { name: "Admit Patient" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(`No beds available right now. ${cleaningBeds.length + availableBeds.length} beds are being cleaned, ${maintenanceCount} under maintenance.`)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled()
    const markAvailable = dialog.getByRole("button", { name: "Mark cleaning beds available" })
    await expect(markAvailable).toBeVisible()
    await markAvailable.click()
    await expect(dialog.getByText(/No beds available right now/)).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Mark cleaning beds available" })).toHaveCount(0)
    const refreshedCounts = await readBedCounts(request, headers)
    expect(refreshedCounts.cleaning).toBe(0)
    expect(refreshedCounts.available).toBe(availableBeds.length + cleaningBeds.length)
  } finally {
    for (const bed of [...availableBeds, ...cleaningBeds]) {
      const originalStatus = startingBeds.find((startingBed) => startingBed.id === bed.id)!.status
      const response = await request.patch(`${apiBase}/wards/beds/${bed.id}/status`, { headers, data: { status: originalStatus } })
      expect(response.ok(), await response.text()).toBeTruthy()
    }
  }
})