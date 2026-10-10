import { test, expect } from "@playwright/test"
import { apiBase, first, login, openDashboard } from "./test-helpers"

test("nurse workflow records vitals, completes a task, and hides admin assignment controls from nurses", async ({ page, request }) => {
  const adminSession = await login(request)
  const headers = { Authorization: `Bearer ${adminSession.accessToken}` }
  const nurses = await first<Array<{ id: string; role: string }>>(request, "/users?limit=100&search=nurse", headers)
  const wards = await first<Array<{ id: string }>>(request, "/wards", headers)
  let admissions = await first<Array<{ id: string }>>(request, "/wards/admissions?limit=100&status=ACTIVE", headers)
  expect(nurses.length).toBeGreaterThan(0)
  expect(wards.length).toBeGreaterThan(0)
  if (admissions.length === 0) {
    const patients = await first<Array<{ id: string }>>(request, "/patients?limit=100", headers)
    const beds = await first<Array<{ id: string; status: string }>>(request, "/wards/beds/availability", headers)
    const patient = patients[0]
    const bed = beds.find((item) => item.status === "AVAILABLE")
    const doctor = (await first<Array<{ id: string }>>(request, "/appointments/doctors", headers))[0]
    expect(patient).toBeTruthy()
    expect(bed).toBeTruthy()
    expect(doctor).toBeTruthy()
    const admission = await request.post(`${apiBase}/wards/admissions`, { headers, data: { patientId: patient.id, bedId: bed!.id, attendingDoctorId: doctor.id, admissionType: "PLANNED", admissionReason: "Nurse panel E2E", depositAmount: 1 } })
    expect(admission.ok(), await admission.text()).toBeTruthy()
    admissions = [(await admission.json()).data as { id: string }]
  }
  const assignment = await request.post(`${apiBase}/nursing/assignments`, { headers, data: { nurseUserId: nurses[0].id, wardId: wards[0].id, shiftDate: new Date().toISOString().slice(0, 10), shiftType: "MORNING" } })
  expect(assignment.ok()).toBeTruthy()
  expect((await request.post(`${apiBase}/nursing/vitals`, { headers, data: { admissionId: admissions[0].id, temperature: 37, pulse: 72, oxygenSaturation: 98 } })).ok()).toBeTruthy()
  const task = await request.post(`${apiBase}/nursing/tasks`, { headers, data: { admissionId: admissions[0].id, taskDescription: `E2E nursing task ${Date.now()}` } })
  expect(task.ok()).toBeTruthy()
  const taskId = (await task.json()).data.id
  expect((await request.post(`${apiBase}/nursing/tasks/${taskId}/complete`, { headers })).ok()).toBeTruthy()
  await openDashboard(page, adminSession, "/dashboard/nurse")
  await expect(page.getByRole("heading", { name: /Nurse/i })).toBeVisible()
  await expect(page.getByText("Nurse Assignment", { exact: true })).toBeVisible()
  const nurseSession = await login(request, { email: "nurse@careplus.local", password: "Staff@12345" })
  await openDashboard(page, nurseSession, "/dashboard/nurse")
  await expect(page.getByText("Nurse Assignment", { exact: true })).toHaveCount(0)
  await request.post(`${apiBase}/wards/admissions/${admissions[0].id}/discharge`, {
    headers,
    data: {
      diagnosis: "Nurse E2E teardown",
      conditionAtDischarge: "Stable",
      instructions: "Test cleanup.",
    },
  })
})
