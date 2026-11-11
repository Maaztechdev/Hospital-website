import { test, expect, type APIRequestContext, type Page } from "@playwright/test"

const apiBase = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000/api/v1"

const credentials = {
  admin: { email: "admin@careplus.local", password: "Admin@12345" },
  doctor: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
  pharmacist: { email: "pharmacist@careplus.local", password: "Staff@12345" },
  labtech: { email: "labtech@careplus.local", password: "Staff@12345" },
}

interface AuthTokens {
  accessToken: string
  refreshToken: string
}

async function apiLogin(request: APIRequestContext, creds: { email: string; password: string }): Promise<AuthTokens> {
  const res = await request.post(`${apiBase}/auth/login`, { data: creds })
  expect(res.ok(), `Login failed for ${creds.email}`).toBeTruthy()
  return (await res.json()).data as AuthTokens
}

async function setSession(page: Page, tokens: AuthTokens) {
  await page.goto("/dashboard/login")
  await page.evaluate((tok) => {
    sessionStorage.setItem("careplus.accessToken", tok.accessToken)
    sessionStorage.setItem("careplus.refreshToken", tok.refreshToken)
  }, tokens)
}

test("Patient Journey Spec B: Lab, Ultrasound, Pharmacy dispense/POS/void/khata, and Billing invoice/payment/print", async ({ page, request }) => {
  // Login tokens
  const adminSession = await apiLogin(request, credentials.admin)
  const doctorSession = await apiLogin(request, credentials.doctor)
  const pharmacistSession = await apiLogin(request, credentials.pharmacist)
  const labtechSession = await apiLogin(request, credentials.labtech)

  const adminHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
  const doctorHeaders = { Authorization: `Bearer ${doctorSession.accessToken}` }
  const pharmacistHeaders = { Authorization: `Bearer ${pharmacistSession.accessToken}` }
  const labtechHeaders = { Authorization: `Bearer ${labtechSession.accessToken}` }

  // 0. Create fresh patient for journey B
  const suffix = Date.now().toString().slice(-6)
  const patientRes = await request.post(`${apiBase}/patients`, {
    headers: adminHeaders,
    data: {
      firstName: "JourneyB",
      lastName: `Patient${suffix}`,
      phone: `0300${suffix}2`,
      age: 40,
      gender: "MALE",
      address: "Lahore, Pakistan",
    },
  })
  expect(patientRes.ok(), await patientRes.text()).toBeTruthy()
  const patient = (await patientRes.json()).data as { id: string; mrNumber: string }
  const patientId = patient.id

  // -------------------------------------------------------------
  // Part 1: Lab Sample -> Result -> Verify -> Print
  // -------------------------------------------------------------
  const testsRes = await request.get(`${apiBase}/lab/tests`, { headers: adminHeaders })
  expect(testsRes.ok()).toBeTruthy()
  const labTests = (await testsRes.json()).data as Array<{ id: string; testName: string; parameters?: Array<{ id: string; resultType: string }> }>
  const selectedLabTest = labTests[0]
  expect(selectedLabTest).toBeTruthy()

  const labOrderRes = await request.post(`${apiBase}/lab/orders`, {
    headers: adminHeaders,
    data: {
      patientId,
      testId: selectedLabTest.id,
      priority: "ROUTINE",
      sampleType: "Blood",
    },
  })
  expect(labOrderRes.ok(), await labOrderRes.text()).toBeTruthy()
  const labOrder = (await labOrderRes.json()).data as { id: string; orderNumber: string }

  // Sample collection
  const sampleRes = await request.patch(`${apiBase}/lab/orders/${labOrder.id}/sample-status`, {
    headers: labtechHeaders,
    data: { status: "SAMPLE_COLLECTED" },
  })
  expect(sampleRes.ok(), await sampleRes.text()).toBeTruthy()

  // Enter results
  const params = selectedLabTest.parameters ?? []
  const resultPayload = params.length
    ? {
        parameters: params.map((p) => ({ parameterId: p.id, value: p.resultType === "NUMERIC" ? "5.0" : "Normal" })),
        technicianNotes: "Spec B test notes",
        reportRemarks: "Spec B lab report remarks",
      }
    : {
        resultValue: "5.0",
        unit: "mmol/L",
        referenceRange: "3.5 - 5.5",
        interpretation: "NORMAL",
        technicianNotes: "Spec B test notes",
        reportRemarks: "Spec B lab report remarks",
      }

  const resultRes = await request.post(`${apiBase}/lab/orders/${labOrder.id}/results`, {
    headers: labtechHeaders,
    data: resultPayload,
  })
  expect(resultRes.ok(), await resultRes.text()).toBeTruthy()

  // Verify lab report
  const savedResultJson = (await resultRes.json()).data
  const expectedUpdatedAt = savedResultJson?.amendedAt || savedResultJson?.createdAt || new Date().toISOString()
  const labVerifyRes = await request.post(`${apiBase}/lab/orders/${labOrder.id}/verify`, {
    headers: adminHeaders,
    data: { expectedUpdatedAt },
  })
  expect(labVerifyRes.ok(), await labVerifyRes.text()).toBeTruthy()

  // UI verification and print view
  await setSession(page, adminSession)
  await page.goto(`/dashboard/lab/${labOrder.id}`)
  await expect(page.getByText(labOrder.orderNumber).first()).toBeVisible()
  await expect(page.getByText("Verified").last()).toBeVisible()
  const printReportBtn = page.getByRole("button", { name: "Print Report" })
  await expect(printReportBtn).toBeVisible()
  await expect(page.locator("#lab-report-print")).toBeAttached()

  // -------------------------------------------------------------
  // Part 2: Ultrasound Report -> Verify
  // -------------------------------------------------------------
  const usOrderRes = await request.post(`${apiBase}/ultrasound`, {
    headers: doctorHeaders,
    data: {
      patientId,
      examType: "Abdomen",
      priority: "ROUTINE",
      notes: "Spec B ultrasound order",
    },
  })
  expect(usOrderRes.ok(), await usOrderRes.text()).toBeTruthy()
  const usOrder = (await usOrderRes.json()).data as { id: string }

  // Schedule ultrasound
  const scheduleRes = await request.patch(`${apiBase}/ultrasound/${usOrder.id}/schedule`, {
    headers: adminHeaders,
    data: {
      scheduledAt: new Date().toISOString(),
      technicianId: adminSession.user.id,
    },
  })
  expect(scheduleRes.ok(), await scheduleRes.text()).toBeTruthy()

  // Start ultrasound
  const startRes = await request.patch(`${apiBase}/ultrasound/${usOrder.id}/start`, {
    headers: adminHeaders,
  })
  expect(startRes.ok(), await startRes.text()).toBeTruthy()

  // Complete ultrasound examination (record findings & impression)
  const usCompleteRes = await request.patch(`${apiBase}/ultrasound/${usOrder.id}/complete`, {
    headers: adminHeaders,
    data: {
      findings: "Liver, gallbladder, pancreas, spleen, and kidneys appear normal in size and echotexture.",
      impression: "Normal abdominal ultrasound study.",
    },
  })
  expect(usCompleteRes.ok(), await usCompleteRes.text()).toBeTruthy()

  // Verify ultrasound report
  const usVerifyRes = await request.patch(`${apiBase}/ultrasound/${usOrder.id}/verify`, {
    headers: adminHeaders,
  })
  expect(usVerifyRes.ok(), await usVerifyRes.text()).toBeTruthy()
  const verifiedUs = (await usVerifyRes.json()).data as { status: string }
  expect(verifiedUs.status).toBe("VERIFIED")

  // -------------------------------------------------------------
  // Part 3: Pharmacy Dispense (stock decreases, FEFO)
  // -------------------------------------------------------------
  // Find a medicine with batches in stock
  const medsRes = await request.get(`${apiBase}/pharmacy/medicines?limit=100`, { headers: pharmacistHeaders })
  expect(medsRes.ok()).toBeTruthy()
  const medicines = (await medsRes.json()).data as Array<{
    id: string
    name: string
    batches: Array<{ id: string; batchNumber: string; stockQuantity: number; expiryDate: string }>
  }>
  // Find a medicine where the earliest batch with positive stock has at least 5 units
  let medWithStock: typeof medicines[0] | undefined
  let earliestBatch: typeof medicines[0]["batches"][0] | undefined

  for (const m of medicines) {
    const positiveBatches = m.batches
      .filter((b) => b.stockQuantity > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
    if (positiveBatches.length > 0 && positiveBatches[0].stockQuantity >= 5) {
      medWithStock = m
      earliestBatch = positiveBatches[0]
      break
    }
  }

  if (!medWithStock || !earliestBatch) {
    const medName = `Journey B Med ${Date.now()}`
    const createRes = await request.post(`${apiBase}/pharmacy/medicines`, {
      headers: adminHeaders,
      data: {
        name: medName,
        genericName: "Paracetamol",
        strength: "500mg",
        form: "Tablet",
        unitType: "TABLET",
        initialBatch: {
          batchNumber: `BAT-${Date.now().toString().slice(-6)}`,
          expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
          purchasePrice: 10,
          sellingPrice: 15,
          stockQuantity: 50,
        },
      },
    })
    expect(createRes.ok(), await createRes.text()).toBeTruthy()
    const newMed = (await createRes.json()).data as {
      id: string
      name: string
      batches: Array<{ id: string; batchNumber: string; stockQuantity: number; expiryDate: string }>
    }
    medWithStock = newMed
    earliestBatch = newMed.batches[0]
  }

  const initialStock = earliestBatch.stockQuantity

  // Create consultation and signed prescription
  const doctorsRes = await request.get(`${apiBase}/appointments/doctors`, { headers: adminHeaders })
  const allDoctors = (await doctorsRes.json()).data as Array<{ id: string; user?: { name: string }; name?: string; department?: { id: string } }>
  const doctor = allDoctors.find((d) => d.name?.includes("Ahmed") || d.user?.name?.includes("Ahmed")) || allDoctors[0]
  let appointmentDate = ""
  let timeSlot = ""
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidateDate = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
    const slotsRes = await request.get(`${apiBase}/appointments/doctors/${doctor.id}/slots?date=${candidateDate}`, { headers: adminHeaders })
    if (!slotsRes.ok()) continue
    const slotsData = ((await slotsRes.json()).data as { availableSlots?: string[] }) || {}
    if (slotsData.availableSlots && slotsData.availableSlots.length > 0) {
      appointmentDate = candidateDate
      timeSlot = slotsData.availableSlots[0]
      break
    }
  }
  expect(appointmentDate && timeSlot).toBeTruthy()

  const apptRes = await request.post(`${apiBase}/appointments`, {
    headers: adminHeaders,
    data: {
      patientId,
      doctorId: doctor.id,
      departmentId: doctor.department?.id,
      appointmentDate,
      timeSlot,
      appointmentType: "NEW_VISIT",
      status: "CONFIRMED",
      feePaid: true,
      paymentMethod: "CASH",
    },
  })
  expect(apptRes.ok(), await apptRes.text()).toBeTruthy()
  const apptId = (await apptRes.json()).data.id as string

  const consultRes = await request.post(`${apiBase}/consultations`, {
    headers: adminHeaders,
    data: {
      appointmentId: apptId,
      chiefComplaint: "Spec B Pharmacy journey consultation",
      diagnosis: "General evaluation",
      vitals: { bp_systolic: 120, bp_diastolic: 80, pulse: 72, temperature: 98.6, oxygen_saturation: 98 },
    },
  })
  expect(consultRes.ok(), await consultRes.text()).toBeTruthy()
  const consultId = (await consultRes.json()).data.id as string

  const rxRes = await request.post(`${apiBase}/prescriptions`, {
    headers: adminHeaders,
    data: {
      consultationId: consultId,
      items: [
        {
          medicineId: medWithStock.id,
          isCatalogItem: true,
          medicineName: medWithStock.name,
          doseAmount: 1,
          doseUnit: "tablet",
          route: "Oral",
          frequencyCode: "OD",
          durationValue: 2,
          durationUnit: "days",
        },
      ],
    },
  })
  expect(rxRes.ok(), await rxRes.text()).toBeTruthy()
  const rx = (await rxRes.json()).data as { id: string; items: Array<{ id: string }> }

  // Sign prescription
  const signRxRes = await request.post(`${apiBase}/prescriptions/${rx.id}/sign`, { headers: adminHeaders })
  expect(signRxRes.ok(), await signRxRes.text()).toBeTruthy()

  // Dispense 2 units
  const dispenseRes = await request.post(`${apiBase}/pharmacy/prescriptions/${rx.id}/dispense`, {
    headers: pharmacistHeaders,
    data: {
      items: [{ prescriptionItemId: rx.items[0].id, quantity: 2 }],
    },
  })
  expect(dispenseRes.ok(), await dispenseRes.text()).toBeTruthy()

  // Verify FEFO stock reduction on earliest expiry batch
  const medCheckRes = await request.get(`${apiBase}/pharmacy/medicines?search=${encodeURIComponent(medWithStock.name)}`, { headers: pharmacistHeaders })
  expect(medCheckRes.ok()).toBeTruthy()
  const foundMeds = (await medCheckRes.json()).data as Array<{ id: string; batches: Array<{ id: string; stockQuantity: number }> }>
  const updatedMed = foundMeds.find((m) => m.id === medWithStock.id)
  expect(updatedMed).toBeTruthy()
  const updatedBatch = updatedMed!.batches.find((b) => b.id === earliestBatch.id)
  expect(updatedBatch).toBeTruthy()
  expect(updatedBatch!.stockQuantity).toBe(initialStock - 2)

  // -------------------------------------------------------------
  // Part 4: POS Sale & Void Isolation (generic billing void refused)
  // -------------------------------------------------------------
  const posSaleRes = await request.post(`${apiBase}/pharmacy/sales`, {
    headers: pharmacistHeaders,
    data: {
      patientId,
      customerName: "Journey B Customer",
      customerPhone: "03001234567",
      items: [{ medicineId: medWithStock.id, quantity: 1 }],
      paymentMethod: "CASH",
    },
  })
  expect(posSaleRes.ok(), await posSaleRes.text()).toBeTruthy()
  const posSale = (await posSaleRes.json()).data as { id: string; invoiceId: string }
  const posInvoiceId = posSale.invoiceId
  expect(posInvoiceId).toBeTruthy()

  // Try voiding pharmacy invoice via generic billing -> MUST RETURN 409 Conflict
  const genericBillingVoidRes = await request.post(`${apiBase}/billing/invoices/${posInvoiceId}/void`, {
    headers: adminHeaders,
    data: { reason: "Attempted generic billing void on pharmacy sale" },
  })
  expect(genericBillingVoidRes.status(), "Generic billing void on pharmacy sale must be refused with 409").toBe(409)
  const voidErrorText = await genericBillingVoidRes.text()
  expect(voidErrorText).toContain("Pharmacy invoices must be voided through the pharmacy sale workflow")

  // Void via proper pharmacy workflow -> MUST SUCCEED
  const pharmacyVoidRes = await request.post(`${apiBase}/pharmacy/invoices/${posInvoiceId}/void`, {
    headers: pharmacistHeaders,
    data: { reason: "Valid pharmacy return and refund" },
  })
  expect(pharmacyVoidRes.ok(), await pharmacyVoidRes.text()).toBeTruthy()

  // -------------------------------------------------------------
  // Part 5: Khata Credit Sale + Payment
  // -------------------------------------------------------------
  const creditSaleRes = await request.post(`${apiBase}/pharmacy/sales`, {
    headers: pharmacistHeaders,
    data: {
      patientId,
      customerName: "Journey B Credit Patient",
      customerPhone: "03001234567",
      items: [{ medicineId: medWithStock.id, quantity: 1 }],
      paymentMethod: "CREDIT",
    },
  })
  expect(creditSaleRes.ok(), await creditSaleRes.text()).toBeTruthy()
  const creditSale = (await creditSaleRes.json()).data as { id: string; totalAmount: number }

  // Find patient's ledger account
  const ledgerAccountsRes = await request.get(`${apiBase}/pharmacy/khata/accounts?patientId=${patientId}`, {
    headers: pharmacistHeaders,
  })
  expect(ledgerAccountsRes.ok()).toBeTruthy()
  const ledgerData = (await ledgerAccountsRes.json()).data as { items: Array<{ id: string; balance: number }> }
  expect(ledgerData.items.length).toBeGreaterThan(0)
  const khataAccount = ledgerData.items[0]

  // Pay off the credit sale
  const ledgerPayRes = await request.post(`${apiBase}/pharmacy/khata/accounts/${khataAccount.id}/payments`, {
    headers: pharmacistHeaders,
    data: {
      amount: Number(creditSale.totalAmount),
      paymentMethod: "CASH",
      notes: "Khata settlement E2E",
    },
  })
  expect(ledgerPayRes.ok(), await ledgerPayRes.text()).toBeTruthy()

  // -------------------------------------------------------------
  // Part 6: Billing Invoice + Payment + Print
  // -------------------------------------------------------------
  const billingInvRes = await request.post(`${apiBase}/billing/invoices`, {
    headers: adminHeaders,
    data: {
      patientId,
      department: "RECEPTION",
      items: [
        {
          itemType: "CONSULTATION",
          description: "General Consultation Fee",
          unitPrice: 1500,
          quantity: 1,
        },
      ],
    },
  })
  expect(billingInvRes.ok(), await billingInvRes.text()).toBeTruthy()
  const billingInvoice = (await billingInvRes.json()).data as { id: string; invoiceNumber: string; grandTotal: number; balanceAmount: number }

  // Pay invoice
  const payRes = await request.post(`${apiBase}/billing/invoices/${billingInvoice.id}/payments`, {
    headers: adminHeaders,
    data: {
      amount: Number(billingInvoice.grandTotal ?? billingInvoice.balanceAmount ?? 1500),
      paymentMethod: "CASH",
    },
  })
  expect(payRes.ok(), await payRes.text()).toBeTruthy()

  // UI verification and print view
  await page.goto(`/dashboard/billing/${billingInvoice.id}`)
  await expect(page.getByText(billingInvoice.invoiceNumber).first()).toBeVisible()
  await expect(page.locator(".rounded-full").getByText("Paid", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Print Invoice" })).toBeVisible()
  await expect(page.locator("#invoice-print-root")).toBeAttached()
})
