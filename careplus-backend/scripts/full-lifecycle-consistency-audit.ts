type Envelope<T> = { success: boolean; data: T; message?: string | null }
type Session = { accessToken: string; user: { id: string } }
type AnyRecord = Record<string, any>

const baseUrl = (process.env.API_URL ?? "http://127.0.0.1:4000/api/v1").replace(/\/$/, "")
const credentials = { email: process.env.AUDIT_EMAIL ?? "admin@careplus.local", password: process.env.AUDIT_PASSWORD ?? "Admin@12345" }
const runId = Date.now().toString(36)

async function api<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = (await response.json()) as Envelope<T>
  if (!response.ok || !body.success) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${body.message ?? "unknown error"}`)
  return body.data
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CONSISTENCY FAILURE: ${message}`)
}

async function auditFor(token: string, entityId: string) {
  const result = await api<AnyRecord>(`/audit-logs?entityId=${entityId}&limit=200`, token)
  return (result.items ?? result) as AnyRecord[]
}

async function expectAudit(token: string, entityId: string, action: string, label: string) {
  const logs = await auditFor(token, entityId)
  assert(logs.some((log) => log.action === action), `${label} has no ${action} audit entry`)
}

async function main() {
  const session = await api<Session>("/auth/login", "", { method: "POST", body: JSON.stringify(credentials) })
  const token = session.accessToken
  const headers = { Authorization: `Bearer ${token}` }

  const patient = await api<AnyRecord>("/patients", token, {
    method: "POST",
    body: JSON.stringify({ firstName: "Lifecycle", lastName: `Audit-${runId}`, dateOfBirth: "1990-01-01", gender: "OTHER", phone: `0300${Date.now().toString().slice(-7)}` }),
  })
  assert(patient.id && patient.mrNumber, "patient registration did not return an id and MR number")
  await expectAudit(token, patient.id, "CREATE", "patient")

  const doctors = await api<AnyRecord[]>("/appointments/doctors", token)
  const doctor = doctors[0]
  assert(doctor?.id, "no available doctor is seeded")
  const tomorrowDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const slots = await api<AnyRecord>(`/appointments/doctors/${doctor.id}/slots?date=${tomorrowDate}`, token)
  const timeSlot = slots.availableSlots?.[0]
  assert(timeSlot, "doctor has no available appointment slot tomorrow")
  const appointment = await api<AnyRecord>("/appointments", token, {
    method: "POST",
    body: JSON.stringify({ patientId: patient.id, doctorId: doctor.id, appointmentDate: tomorrowDate, timeSlot, appointmentType: "NEW_VISIT", source: "WALK_IN", reason: "Full lifecycle audit" }),
  })
  assert(appointment.patientId === patient.id, "appointment patient_id does not match patient")
  await expectAudit(token, appointment.id, "CREATE", "appointment")

  const approved = await api<AnyRecord>(`/appointments/${appointment.id}/approve`, token, { method: "POST" })
  assert(approved.patientId === patient.id && approved.status === "CONFIRMED", "appointment approval lost patient link or state")
  await expectAudit(token, appointment.id, "STATUS_CHANGE", "appointment approval")

  const waiting = await api<AnyRecord>(`/opd-queue/${doctor.id}/call-next`, token, { method: "POST" })
  assert(waiting.id === appointment.id && waiting.patientId === patient.id && waiting.status === "WAITING", "check-in did not move the same appointment to WAITING")
  await expectAudit(token, appointment.id, "STATUS_CHANGE", "check-in")

  const inConsultation = await api<AnyRecord>(`/opd-queue/${appointment.id}/start-consultation`, token, { method: "POST" })
  assert(inConsultation.id === appointment.id && inConsultation.status === "IN_CONSULTATION", "consultation start did not propagate to appointment")
  await expectAudit(token, appointment.id, "STATUS_CHANGE", "consultation start")

  const consultation = await api<AnyRecord>("/consultations", token, { method: "POST", body: JSON.stringify({ appointmentId: appointment.id, diagnosis: "Lifecycle audit diagnosis", clinicalNotes: "Direct API consistency audit" }) })
  assert(consultation.appointmentId === appointment.id, "consultation appointment_id does not match appointment")
  assert(consultation.patientId === patient.id, "consultation patient_id does not match patient")
  await expectAudit(token, consultation.id, "CREATE", "consultation")

  const medicines = await api<AnyRecord[]>("/pharmacy/medicines?limit=100", token)
  const catalogMedicine = medicines.find((medicine) => medicine.batches?.some((candidate: AnyRecord) => candidate.stockQuantity >= 0))
  assert(catalogMedicine?.id, "no catalog medicine is seeded")
  const prescription = await api<AnyRecord>("/prescriptions", token, { method: "POST", body: JSON.stringify({ consultationId: consultation.id, items: [{ medicineId: catalogMedicine.id, medicineName: catalogMedicine.name, dosage: "500mg", route: "Oral", frequency: "Once daily", durationDays: 1 }] }) })
  assert(prescription.consultationId === consultation.id, "prescription consultation_id does not match consultation")
  assert(prescription.patientId === patient.id, "prescription patient_id does not match patient")
  await expectAudit(token, prescription.id, "CREATE", "prescription")
  await api<AnyRecord>(`/prescriptions/${prescription.id}/sign`, token, { method: "POST" })
  await expectAudit(token, prescription.id, "SIGN", "prescription signing")
  const signedPrescription = await api<AnyRecord>(`/prescriptions/${prescription.id}`, token)
  const prescriptionItem = signedPrescription.items?.[0]
  assert(prescriptionItem?.id, "signed prescription has no item")
  assert(signedPrescription.status === "SIGNED", "prescription state did not propagate to SIGNED")

  const batch = catalogMedicine.batches.find((candidate: AnyRecord) => candidate.stockQuantity >= 0)
  assert(batch?.id, "no medicine batch is seeded")
  await api("/pharmacy/stock-in", token, { method: "POST", body: JSON.stringify({ batchId: batch.id, quantity: 1, reason: "Lifecycle audit" }) })
  await expectAudit(token, batch.id, "UPDATE", "pharmacy stock-in")
  const dispensed = await api<AnyRecord>("/pharmacy/dispense", token, { method: "POST", body: JSON.stringify({ prescriptionItemId: prescriptionItem.id, quantity: 1 }) })
  assert(dispensed.prescriptionId === prescription.id, "dispense did not retain prescription link")
  await expectAudit(token, prescriptionItem.id, "DISPENSE", "pharmacy dispense")

  const tests = await api<AnyRecord[]>("/lab/tests", token)
  assert(tests[0]?.id, "no lab test is seeded")
  const labOrder = await api<AnyRecord>("/lab/orders", token, { method: "POST", body: JSON.stringify({ patientId: patient.id, doctorId: doctor.id, testId: tests[0].id, priority: "ROUTINE", sampleType: "Blood" }) })
  assert(labOrder.patientId === patient.id, "lab order patient_id does not match patient")
  await expectAudit(token, labOrder.id, "CREATE", "lab order")
  await api(`/lab/orders/${labOrder.id}/sample-status`, token, { method: "PATCH", body: JSON.stringify({ status: "SAMPLE_COLLECTED" }) })
  await expectAudit(token, labOrder.id, "STATUS_CHANGE", "lab sample collection")
  const result = await api<AnyRecord>(`/lab/orders/${labOrder.id}/results`, token, { method: "POST", body: JSON.stringify({ resultValue: "Normal", interpretation: "NORMAL" }) })
  assert(result.labOrderId === labOrder.id, "lab result lab_order_id does not match order")
  await expectAudit(token, result.id, "CREATE", "lab result")
  const verifiedOrder = await api<AnyRecord>(`/lab/orders/${labOrder.id}/verify`, token, { method: "POST" })
  assert(verifiedOrder.id === labOrder.id && verifiedOrder.status === "VERIFIED", "lab verification state did not propagate")
  await expectAudit(token, labOrder.id, "VERIFY", "lab verification")

  const invoice = await api<AnyRecord>("/billing/invoices", token, { method: "POST", body: JSON.stringify({ patientId: patient.id, items: [{ itemType: "CONSULTATION", description: "Lifecycle audit consultation", quantity: 1, unitPrice: 100, discount: 0 }] }) })
  assert(invoice.patientId === patient.id, "invoice patient_id does not match patient")
  await expectAudit(token, invoice.id, "CREATE", "invoice")
  const paidInvoice = await api<AnyRecord>(`/billing/invoices/${invoice.id}/payments`, token, { method: "POST", body: JSON.stringify({ paymentMethod: "CASH", amount: 100, notes: "Lifecycle audit" }) })
  assert(paidInvoice.id === invoice.id && paidInvoice.status === "PAID" && Number(paidInvoice.paidAmount) === 100, "payment did not propagate invoice state")
  const invoiceWithPayment = await api<AnyRecord>(`/billing/invoices/${invoice.id}`, token)
  const payment = invoiceWithPayment.payments?.find((candidate: AnyRecord) => candidate.invoiceId === invoice.id)
  assert(payment?.id, "payment is orphaned from invoice")
  await expectAudit(token, payment.id, "CREATE", "invoice payment")

  const beds = await api<AnyRecord[]>("/wards/beds/availability", token)
  const bed = beds.find((candidate) => candidate.status === "AVAILABLE")
  assert(bed?.id, "no available bed is seeded")
  const admission = await api<AnyRecord>("/wards/admissions", token, { method: "POST", body: JSON.stringify({ patientId: patient.id, bedId: bed.id, attendingDoctorId: doctor.id, admissionType: "PLANNED", admissionReason: "Lifecycle audit admission" }) })
  assert(admission.patientId === patient.id && admission.bedId === bed.id, "admission foreign keys do not match patient or bed")
  await expectAudit(token, admission.id, "ADMIT", "ward admission")
  const discharged = await api<AnyRecord>(`/wards/admissions/${admission.id}/discharge`, token, { method: "POST", body: JSON.stringify({ dischargeSummary: "Lifecycle audit discharge" }) })
  assert(discharged.id === admission.id && discharged.patientId === patient.id && discharged.status === "DISCHARGED", "discharge did not retain admission link or state")
  await expectAudit(token, admission.id, "DISCHARGE", "ward discharge")

  const finalPatient = await api<AnyRecord>(`/patients/${patient.id}`, token)
  assert(finalPatient.id === patient.id, "final patient read returned a different record")
  const finalAppointments = await api<AnyRecord[]>(`/appointments?limit=100&status=DONE`, token)
  assert(!finalAppointments.some((item) => item.id === appointment.id && item.patientId !== patient.id), "appointment became linked to another patient")
  console.log(JSON.stringify({ ok: true, patientId: patient.id, appointmentId: appointment.id, consultationId: consultation.id, prescriptionId: prescription.id, labOrderId: labOrder.id, invoiceId: invoice.id, admissionId: admission.id, auditEntriesChecked: "every mutation" }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
