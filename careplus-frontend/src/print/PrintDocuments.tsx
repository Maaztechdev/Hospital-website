import * as React from "react"
import { Route, Routes, useParams, useSearchParams } from "react-router-dom"
import { api, loadAuthenticatedImage, type ApiHospitalProfile, type ApiPharmacySale, type ApiUser } from "@/lib/api"
import { DEFAULT_HOSPITAL_PROFILE } from "@/lib/hospitalProfile"
import { printElement } from "@/lib/print"
import { InvoicePrintDocument } from "@/dashboard/pages/pharmacy/PharmacyPrintDocuments"

type PrintContent = {
  printedBy: ApiUser
  hospital: ApiHospitalProfile
}

function printDate(value?: string | null) {
  if (!value) return "Not recorded"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-PK", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
}

function valueOrNotRecorded(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "Not recorded"
  return String(value)
}

function formatGender(gender?: string | null): string {
  if (!gender) return "Not recorded"
  const upper = gender.toUpperCase()
  if (upper === "MALE") return "Male"
  if (upper === "FEMALE") return "Female"
  if (upper === "OTHER") return "Other"
  return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase()
}

function usePrintImages(paths: Array<string | null | undefined> | null) {
  const [images, setImages] = React.useState<Array<string | null> | null>(null)
  const pathsKey = JSON.stringify(paths)
  React.useEffect(() => {
    if (pathsKey === "null") {
      setImages(null)
      return
    }
    let active = true
    let resolvedUrls: Array<string | null> = []
    const imagePaths = JSON.parse(pathsKey) as Array<string | null | undefined>
    void Promise.all(imagePaths.map((path) => loadAuthenticatedImage(path))).then((resolved) => {
      resolvedUrls = resolved
      if (active) setImages(resolved)
      else resolved.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    })
    return () => {
      active = false
      resolvedUrls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    }
  }, [pathsKey])
  return images
}

function usePrintAfterReady(ready: boolean) {
  const printed = React.useRef(false)
  React.useEffect(() => {
    if (!ready) {
      printed.current = false
      return
    }
    if (printed.current) return
    printed.current = true
    void printElement("careplus-print-root").catch(() => {})
  }, [ready])
}

function Loading({ error }: { error: string | null }) {
  return (
    <main
      className="flex min-h-[50vh] items-center justify-center bg-[var(--cp-bg,#f8fafc)] p-6 text-center font-sans print:hidden"
      role={error ? "alert" : "status"}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--cp-border-soft,#e2e8f0)] bg-white p-6 shadow-sm">
        {error ? (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <span className="text-xl font-bold">!</span>
            </div>
            <h2 className="mb-1 text-base font-semibold text-[var(--cp-ink,#0f172a)]">Print Document Unavailable</h2>
            <p className="mb-4 text-xs text-[var(--cp-ink-soft,#64748b)]">{error}</p>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-[var(--cp-primary,#1769AA)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--cp-primary-dark,#0F4C7A)]"
            >
              Go Back
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-3 border-[var(--cp-primary,#1769AA)] border-t-transparent" />
            <h2 className="text-sm font-semibold text-[var(--cp-ink,#0f172a)]">Preparing print document…</h2>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft,#64748b)]">Please wait while document records are loaded.</p>
          </>
        )}
      </div>
    </main>
  )
}

function DocumentLayout({
  title,
  hospital,
  logo,
  printedBy,
  patientName,
  mrNumber,
  children,
}: PrintContent & {
  title: string
  logo: string | null
  patientName: string
  mrNumber: string
  children: React.ReactNode
}) {
  return (
    <main id="careplus-print-root" className="careplus-print-sheet">
      <header className="careplus-print-header">
        {logo ? <img className="careplus-print-logo" src={logo} alt={`${hospital.name} logo`} /> : <span className="careplus-print-logo-fallback" aria-label="Hospital logo unavailable">CP</span>}
        <div className="careplus-print-hospital">
          <h1>{hospital.name}</h1>
          <p>{[hospital.address, hospital.phone, hospital.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="careplus-print-title"><h2>{title}</h2><p>{patientName} · {mrNumber}</p></div>
      </header>
      <div className="careplus-print-body">{children}</div>
      <footer className="careplus-print-footer">
        <span>Printed {printDate(new Date().toISOString())} · Printed by {printedBy.name}</span>
        <span>Page <span className="careplus-page-number" /></span>
      </footer>
      <button className="careplus-print-action no-print" onClick={() => void printElement("careplus-print-root")}>Print</button>
    </main>
  )
}

function PrintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="careplus-print-section"><h3>{title}</h3>{children}</section>
}

function PrintRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <dl className="careplus-print-rows">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function PrintList({ items, empty = "Not recorded" }: { items: string[]; empty?: string }) {
  return items.length ? <ul className="careplus-print-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{empty}</p>
}

function useDocumentData<T>(load: () => Promise<T>) {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let active = true
    load().then((result) => { if (active) setData(result) }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load print document data.")
    })
    return () => { active = false }
  }, [load])
  return { data, error }
}

function PatientSummaryPrintPage() {
  const { patientId = "" } = useParams()
  const load = React.useCallback(async () => {
    const [summary, printedBy, hospital] = await Promise.all([api.getPatientPrintSummary(patientId), api.me(), api.getHospitalProfile()])
    return { summary, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE }
  }, [patientId])
  const { data, error } = useDocumentData(load)
  const images = usePrintImages(data ? [data.hospital.logoUrl] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />
  const { summary, printedBy, hospital } = data
  const patient = summary.patient
  const fullName = `${patient.firstName} ${patient.lastName}`.trim()
  const vitals = summary.lastVitals
  return (
    <DocumentLayout title="Patient Summary" hospital={hospital} logo={images[0]} printedBy={printedBy} patientName={fullName} mrNumber={patient.mrNumber}>
      <PrintSection title="Demographics">
        <PrintRows rows={[
          ["Age / gender", `${valueOrNotRecorded(patient.age)} / ${valueOrNotRecorded(patient.gender)}`],
          ["Date of birth", printDate(patient.dateOfBirth)],
          ["Phone", valueOrNotRecorded(patient.phone)],
          ["Email", valueOrNotRecorded(patient.email)],
          ["Address", valueOrNotRecorded(patient.address)],
          ["CNIC", valueOrNotRecorded(patient.cnic)],
          ["Blood group", valueOrNotRecorded(patient.bloodGroup)],
          ["Emergency contact", `${valueOrNotRecorded(patient.emergencyContactName)} · ${valueOrNotRecorded(patient.emergencyContactPhone)}`],
        ]} />
      </PrintSection>
      <div className="careplus-print-grid">
        <PrintSection title="Allergies"><PrintList items={patient.allergies ?? []} empty="No known allergies" /></PrintSection>
        <PrintSection title="Chronic conditions"><PrintList items={summary.chronicConditions} /></PrintSection>
      </div>
      <PrintSection title="Current / last medicines">
        {summary.medicines.length ? <table><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Prescribed</th></tr></thead><tbody>
          {summary.medicines.map((medicine, index) => <tr key={`${medicine.medicineName}-${index}`}><td>{medicine.medicineName}</td><td>{medicine.dosage}</td><td>{medicine.frequency}</td><td>{medicine.durationDays} days</td><td>{printDate(medicine.prescribedAt)}</td></tr>)}
        </tbody></table> : <p>Not recorded</p>}
      </PrintSection>
      <PrintSection title="Recent visits">
        {summary.recentVisits.length ? <table><thead><tr><th>Date</th><th>Diagnosis</th><th>Presenting complaint</th><th>Specialty</th></tr></thead><tbody>
          {summary.recentVisits.map((visit) => <tr key={visit.id}><td>{printDate(visit.visitDate)}</td><td>{valueOrNotRecorded(visit.diagnosis)}</td><td>{valueOrNotRecorded(visit.chiefComplaint)}</td><td>{valueOrNotRecorded(visit.doctorSpecialty)}</td></tr>)}
        </tbody></table> : <p>Not recorded</p>}
      </PrintSection>
      <div className="careplus-print-grid">
        <PrintSection title="Recent lab results">
          {summary.labResults.length ? <table><thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>Date</th></tr></thead><tbody>
            {summary.labResults.map((result) => <tr key={result.id}><td>{result.testName}</td><td>{result.resultValue} {result.unit ?? ""}</td><td>{valueOrNotRecorded(result.referenceRange)}</td><td>{printDate(result.createdAt)}</td></tr>)}
          </tbody></table> : <p>Not recorded</p>}
        </PrintSection>
        <PrintSection title="Recent ultrasound results">
          {summary.ultrasoundResults.length ? <ul className="careplus-print-list">{summary.ultrasoundResults.map((result) => <li key={result.id}><strong>{result.examinationType}:</strong> {valueOrNotRecorded(result.conclusion)} · {printDate(result.completedAt)}</li>)}</ul> : <p>Not recorded</p>}
        </PrintSection>
      </div>
      <PrintSection title="Last recorded vitals">
        {vitals ? <>
          {vitals.critical && <p className="careplus-print-critical">Critical vitals</p>}
          <PrintRows rows={[
            ["Blood pressure", `${valueOrNotRecorded(vitals.systolic)} / ${valueOrNotRecorded(vitals.diastolic)} mmHg`],
            ["Pulse", vitals.pulse == null ? "Not recorded" : `${vitals.pulse} /min`],
            ["Temperature", vitals.temperature == null ? "Not recorded" : `${vitals.temperature} °${vitals.temperatureUnit ?? "F"}`],
            ["Respiratory rate", vitals.respiratoryRate == null ? "Not recorded" : `${vitals.respiratoryRate} /min`],
            ["Weight", vitals.weight == null ? "Not recorded" : `${vitals.weight} kg`],
            ["SpO2", vitals.oxygenSaturation == null ? "Not recorded" : `${vitals.oxygenSaturation}%`],
            ["Height", vitals.heightCm == null ? "Not recorded" : `${vitals.heightCm} cm`],
            ["Recorded", `${printDate(vitals.recordedAt)}${vitals.estimated ? " (estimated)" : ""}`],
          ]} />
        </> : <p>Not recorded</p>}
      </PrintSection>
      <div className="careplus-print-grid">
        <PrintSection title="Admissions"><PrintList items={summary.admissions.map((item) => `${item.admissionReason} · ${item.bed.room.ward.wardName}, ${item.bed.room.roomNumber}, bed ${item.bed.bedNumber} · ${printDate(item.admissionDate)}–${item.dischargeDate ? printDate(item.dischargeDate) : "Current"}`)} /></PrintSection>
        <PrintSection title="Balance"><p className="careplus-print-balance">{Number(summary.balance).toLocaleString("en-PK", { style: "currency", currency: hospital.currency || "PKR" })}</p></PrintSection>
      </div>
      <button className="no-print" data-testid="print-data-ready" hidden />
    </DocumentLayout>
  )
}

function DischargePrintPage() {
  const { admissionId = "" } = useParams()
  const load = React.useCallback(async () => {
    const [discharge, printedBy, hospital] = await Promise.all([api.getDischargePrintData(admissionId), api.me(), api.getHospitalProfile()])
    return { discharge, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE }
  }, [admissionId])
  const { data, error } = useDocumentData(load)
  const signaturePath = data?.discharge.admission.attendingDoctor.user.staffProfile?.signatureUrl
  const stampPath = data?.discharge.admission.attendingDoctor.user.staffProfile?.stampUrl
  const images = usePrintImages(data ? [data.hospital.logoUrl, signaturePath, stampPath] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />
  const { admission, procedures, labResults, ultrasoundResults, outstandingBalance } = data.discharge
  const { dischargeDetails: details } = admission
  const patientName = `${admission.patient.firstName} ${admission.patient.lastName}`.trim()
  const stayDays = Math.max(1, Math.ceil(((admission.dischargeDate ? new Date(admission.dischargeDate) : new Date()).getTime() - new Date(admission.admissionDate).getTime()) / 86_400_000))
  return (
    <DocumentLayout title="Discharge Summary" hospital={data.hospital} logo={images[0]} printedBy={data.printedBy} patientName={patientName} mrNumber={admission.patient.mrNumber}>
      <PrintSection title="Admission details">
        <PrintRows rows={[
          ["Admission date", printDate(admission.admissionDate)],
          ["Discharge date / time", printDate(admission.dischargeDate)],
          ["Length of stay", `${stayDays} day${stayDays === 1 ? "" : "s"}`],
          ["Ward / bed", `${admission.bed.room.ward.wardName} · ${admission.bed.room.roomNumber} · ${admission.bed.bedNumber}`],
          ["Attending doctor", admission.attendingDoctor.user.name],
          ["Specialty", valueOrNotRecorded(admission.attendingDoctor.specialization)],
        ]} />
      </PrintSection>
      <PrintSection title="Diagnosis"><p>{valueOrNotRecorded(details?.diagnosis ?? admission.dischargeSummary)}</p></PrintSection>
      <PrintSection title="Course in hospital"><p className="careplus-pre-wrap">{valueOrNotRecorded(details?.courseInHospital)}</p></PrintSection>
      <PrintSection title="Procedures / surgeries performed">
        <PrintList items={details?.procedures?.length ? details.procedures : procedures.map((procedure) => `${procedure.surgeryType} · ${procedure.surgeon.user.name} (${valueOrNotRecorded(procedure.surgeon.specialization)}) · ${procedure.status}`)} />
      </PrintSection>
      <PrintSection title="Medications on discharge"><PrintList items={details?.medications ?? []} /></PrintSection>
      <div className="careplus-print-grid">
        <PrintSection title="Latest lab results"><PrintList items={labResults.map((result) => `${result.testName}: ${result.resultValue} ${result.unit ?? ""}${result.referenceRange ? ` (reference ${result.referenceRange})` : ""} · ${printDate(result.createdAt)}`)} /></PrintSection>
        <PrintSection title="Latest ultrasound results"><PrintList items={ultrasoundResults.map((result) => `${result.examinationType}: ${valueOrNotRecorded(result.conclusion)} · ${printDate(result.completedAt)}`)} /></PrintSection>
      </div>
      <PrintSection title="Condition at discharge"><p className="careplus-pre-wrap">{valueOrNotRecorded(details?.conditionAtDischarge)}</p></PrintSection>
      <PrintSection title="Follow-up / referral">
        <PrintRows rows={[
          ["Follow-up date", printDate(details?.followUpDate)],
          ["Referral", valueOrNotRecorded(details?.referral)],
        ]} />
      </PrintSection>
      <PrintSection title="Patient instructions"><p className="careplus-pre-wrap">{valueOrNotRecorded(details?.instructions ?? admission.dischargeNotes)}</p></PrintSection>
      {outstandingBalance > 0 && <p className="careplus-print-balance">Outstanding balance: {Number(outstandingBalance).toLocaleString("en-PK", { style: "currency", currency: data.hospital.currency || "PKR" })}</p>}
      <div className="careplus-print-signatures">
        <div className="careplus-print-signature"><div className="careplus-signature-image">{images[1] && <img src={images[1]} alt={`${admission.attendingDoctor.user.name} signature`} />}</div><div className="careplus-signature-line" /><strong>{admission.attendingDoctor.user.name}</strong><span>Attending Doctor</span></div>
        <div className="careplus-print-signature"><div className="careplus-stamp-image">{images[2] && <img src={images[2]} alt={`${admission.attendingDoctor.user.name} stamp`} />}</div><div className="careplus-signature-line" /><span>Doctor stamp</span></div>
      </div>
      <button className="no-print" data-testid="print-data-ready" hidden />
    </DocumentLayout>
  )
}

function IpdBillPrintPage() {
  const { admissionId = "" } = useParams()
  const [searchParams] = useSearchParams()
  const final = searchParams.get("final") === "true"
  const load = React.useCallback(async () => {
    const [admission, bill, printedBy, hospital] = await Promise.all([
      api.getAdmission(admissionId),
      api.getIpdRunningBill(admissionId),
      api.me(),
      api.getHospitalProfile(),
    ])
    return { admission, bill, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE }
  }, [admissionId])
  const { data, error } = useDocumentData(load)
  const images = usePrintImages(data ? [data.hospital.logoUrl] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />

  const { admission, bill } = data
  const patientName = `${admission.patient.firstName} ${admission.patient.lastName}`.trim()
  const categories = [
    ["Bed", bill.categories.bed],
    ["Medicines", bill.categories.medicines],
    ["Services", bill.categories.services],
    ["Tests", bill.categories.tests],
  ] as const
  const money = (value: number | string) => Number(value ?? 0).toLocaleString("en-PK", { style: "currency", currency: data.hospital.currency || "PKR" })

  return (
    <DocumentLayout title={final ? "Final IPD Bill" : "Interim IPD Running Bill"} hospital={data.hospital} logo={images[0]} printedBy={data.printedBy} patientName={patientName} mrNumber={admission.patient.mrNumber}>
      <PrintSection title="Admission details">
        <PrintRows rows={[
          ["Admission date", printDate(admission.admissionDate)],
          ["Discharge date", printDate(admission.dischargeDate)],
          ["Ward / room / bed", `${admission.bed.room.ward.wardName} · ${admission.bed.room.roomNumber} · ${admission.bed.bedNumber}`],
          ["Invoice", bill.invoice.invoiceNumber],
          ["Status", bill.invoice.status],
        ]} />
      </PrintSection>
      {categories.map(([category, items]) => (
        <PrintSection key={category} title={category}>
          {items.length === 0 ? <p>No {category.toLowerCase()} charges.</p> : (
            <table className="careplus-print-table"><thead><tr><th>Description</th><th>Date</th><th>Qty</th><th className="number">Amount</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id}>
                <td>{item.description}{item.reversalReason ? ` · ${item.reversalReason}` : ""}</td>
                <td>{printDate(item.serviceDate ?? item.createdAt)}</td>
                <td>{item.quantity}</td>
                <td className="number">{money(item.subtotal ?? Number(item.unitPrice) * item.quantity)}</td>
              </tr>)}</tbody>
            </table>
          )}
        </PrintSection>
      ))}
      <PrintSection title="Payments and refunds">
        {bill.invoice.payments.length === 0 ? <p>No payments recorded.</p> : (
          <table className="careplus-print-table"><thead><tr><th>Type</th><th>Date</th><th>Method</th><th>Reference / reason</th><th className="number">Amount</th></tr></thead>
            <tbody>{bill.invoice.payments.map((payment) => <tr key={payment.id}>
              <td>{payment.type === "REFUND" ? "Refund" : payment.purpose === "DEPOSIT" ? "Deposit" : "Payment"}</td>
              <td>{printDate(payment.paymentDate ?? payment.createdAt)}</td>
              <td>{payment.paymentMethod.replaceAll("_", " ")}</td>
              <td>{[payment.referenceNumber, payment.reason, payment.notes].filter(Boolean).join(" · ") || "—"}</td>
              <td className="number">{payment.type === "REFUND" ? "−" : ""}{money(payment.amount)}</td>
            </tr>)}</tbody>
          </table>
        )}
      </PrintSection>
      <PrintSection title="Bill totals">
        <PrintRows rows={[
          ["Total charged", money(bill.totals.charged)],
          ["Net paid", money(bill.totals.paid)],
          ["Balance", money(bill.totals.balance)],
        ]} />
      </PrintSection>
      <div className="careplus-print-signatures">
        <div className="careplus-print-signature"><div className="careplus-signature-line" /><span>Prepared by</span></div>
        <div className="careplus-print-signature"><div className="careplus-signature-line" /><span>Patient / attendant signature</span></div>
        <div className="careplus-print-signature"><div className="careplus-signature-line" /><span>Authorized signature</span></div>
      </div>
      <button className="no-print" data-testid="print-data-ready" hidden />
    </DocumentLayout>
  )
}

function PrescriptionPrintPage() {
  const { consultationId = "" } = useParams()
  const load = React.useCallback(async () => {
    const [prescription, printedBy, hospital] = await Promise.all([api.getConsultationPrescriptionPrintData(consultationId), api.me(), api.getHospitalProfile()])
    return { prescription, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE }
  }, [consultationId])
  const { data, error } = useDocumentData(load)
  const staffProfile = data?.prescription.doctor.user.staffProfile
  const images = usePrintImages(data ? [data.hospital.logoUrl, staffProfile?.signatureUrl, staffProfile?.stampUrl] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />
  const { prescription: consultation, printedBy } = data
  const patientName = `${consultation.patient.firstName} ${consultation.patient.lastName}`.trim()
  const prescriptionRecord = consultation.prescription
  return (
    <DocumentLayout title="Prescription" hospital={data.hospital} logo={images[0]} printedBy={printedBy} patientName={patientName} mrNumber={consultation.patient.mrNumber}>
      <PrintSection title="Patient and visit">
        <PrintRows rows={[
          ["Visit date", printDate(consultation.appointment.appointmentDate)],
          ["Visit number", consultation.appointment.tokenNumber],
          ["Age / gender", `${valueOrNotRecorded(consultation.patient.age)} / ${formatGender(consultation.patient.gender || consultation.prescription?.patientGender || consultation.appointment?.gender)}`],
          ["Contact", valueOrNotRecorded(consultation.patient.phone)],
          ["Allergies", consultation.patient.allergies.length ? consultation.patient.allergies.join(", ") : "No known allergies"],
        ]} />
      </PrintSection>
      <PrintSection title="Diagnosis"><p>{valueOrNotRecorded(consultation.diagnosis)}</p></PrintSection>
      <PrintSection title="Vitals">
        <div className="careplus-compact-vitals">
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">BP</span>
            <span className="careplus-compact-vital-value">{consultation.bpSystolic != null && consultation.bpDiastolic != null ? `${consultation.bpSystolic}/${consultation.bpDiastolic} mmHg` : consultation.bpSystolic != null ? `${consultation.bpSystolic} mmHg` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">Pulse</span>
            <span className="careplus-compact-vital-value">{consultation.pulse != null ? `${consultation.pulse} /min` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">Temp</span>
            <span className="careplus-compact-vital-value">{consultation.temperature != null ? `${consultation.temperature} °${consultation.temperatureUnit ?? "F"}` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">Resp Rate</span>
            <span className="careplus-compact-vital-value">{consultation.respiratoryRate != null ? `${consultation.respiratoryRate} /min` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">Weight</span>
            <span className="careplus-compact-vital-value">{consultation.weight != null ? `${consultation.weight} kg` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">SpO2</span>
            <span className="careplus-compact-vital-value">{consultation.oxygenSaturation != null ? `${consultation.oxygenSaturation}%` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">Height</span>
            <span className="careplus-compact-vital-value">{consultation.heightCm != null ? `${consultation.heightCm} cm` : "—"}</span>
          </div>
          <div className="careplus-compact-vital-chip">
            <span className="careplus-compact-vital-label">BMI</span>
            <span className="careplus-compact-vital-value">{consultation.weight && consultation.heightCm ? (Number(consultation.weight) / ((Number(consultation.heightCm) / 100) ** 2)).toFixed(1) : "—"}</span>
          </div>
        </div>
        {consultation.vitalsEstimated && <p className="careplus-print-muted text-[10px] mt-1">(estimated)</p>}
      </PrintSection>
      <PrintSection title="Medicines">
        {prescriptionRecord.items.length ? <table><thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>
          {prescriptionRecord.items.map((item) => <tr key={item.id}><td>{item.medicineName}</td><td>{item.dosage}</td><td>{valueOrNotRecorded(item.route)}</td><td>{item.frequency}</td><td>{item.durationValue ?? item.durationDays} {item.durationUnit ?? "days"}</td><td>{valueOrNotRecorded(item.instructions)}</td></tr>)}
        </tbody></table> : <p>Not recorded</p>}
      </PrintSection>
      {(consultation.followUpDate || consultation.followUpInstructions) && (
        <PrintSection title="Follow-up">
          <PrintRows rows={[
            ["Next visit", consultation.followUpDate ? printDate(consultation.followUpDate) : "As advised"],
            ...(consultation.followUpInstructions ? [["Instructions", consultation.followUpInstructions]] as Array<[string, React.ReactNode]> : []),
          ]} />
        </PrintSection>
      )}
      <PrintSection title="Clinical findings"><p className="careplus-pre-wrap">{valueOrNotRecorded(consultation.findings ?? consultation.clinicalNotes)}</p></PrintSection>
      <div className="careplus-print-signatures">
        <div className="careplus-print-signature"><div className="careplus-signature-image">{images[1] && <img src={images[1]} alt={`${consultation.doctor.user.name} signature`} />}</div><div className="careplus-signature-line" /><strong>{consultation.doctor.user.name}</strong><span>{[staffProfile?.qualification ?? consultation.doctor.qualification, consultation.doctor.specialization].filter(Boolean).join(" · ") || "Doctor"}</span></div>
        <div className="careplus-print-signature"><div className="careplus-stamp-image">{images[2] && <img src={images[2]} alt={`${consultation.doctor.user.name} stamp`} />}</div><div className="careplus-signature-line" /><span>Doctor stamp</span></div>
      </div>
      <p className="careplus-print-muted">Signed {printDate(prescriptionRecord.signedAt)}</p>
      <button className="no-print" data-testid="print-data-ready" hidden />
    </DocumentLayout>
  )
}

function AdmissionSlipPrintPage() {
  const { admissionId = "" } = useParams()
  const load = React.useCallback(async () => {
    const [admission, printedBy, hospital] = await Promise.all([
      api.getAdmissionSlipPrintData(admissionId),
      api.me(),
      api.getHospitalProfile(),
    ])
    return { admission, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE }
  }, [admissionId])
  const { data, error } = useDocumentData(load)
  const staffProfile = data?.admission.attendingDoctor.user.staffProfile
  const images = usePrintImages(data ? [data.hospital.logoUrl, staffProfile?.signatureUrl, staffProfile?.stampUrl] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />
  const { admission, printedBy, hospital } = data
  const { patient, bed, attendingDoctor } = admission
  const patientName = `${patient.firstName} ${patient.lastName}`.trim()
  const admissionNo = `ADM-${admission.id.slice(0, 8).toUpperCase()}`

  return (
    <DocumentLayout
      title="Ward Admission Slip"
      hospital={hospital}
      logo={images[0]}
      printedBy={printedBy}
      patientName={patientName}
      mrNumber={patient.mrNumber}
    >
      <PrintSection title="Patient & Registration">
        <PrintRows rows={[
          ["Patient Name", patientName],
          ["Patient ID / MR No.", patient.mrNumber],
          ["Age / Gender", `${valueOrNotRecorded(patient.age)} yrs / ${formatGender(patient.gender)}`],
          ["Contact Number", valueOrNotRecorded(patient.phone)],
          ["Address", valueOrNotRecorded(patient.address)],
          ["Blood Group", valueOrNotRecorded(patient.bloodGroup)],
          ["Emergency Contact", patient.emergencyContactName ? `${patient.emergencyContactName}${patient.emergencyContactPhone ? ` (${patient.emergencyContactPhone})` : ""}` : "Not recorded"],
        ]} />
      </PrintSection>

      <PrintSection title="Admission Details">
        <PrintRows rows={[
          ["Admission Number", admissionNo],
          ["Admission Date & Time", printDate(admission.admissionDate)],
          ["Admission Type", valueOrNotRecorded(admission.admissionType)],
          ["Ward Name", bed.room.ward.wardName],
          ["Ward Type", bed.room.ward.wardType],
          ["Room Number", bed.room.roomNumber],
          ["Bed Number", `${bed.bedNumber}${bed.bedLabel ? ` (${bed.bedLabel})` : ""}`],
          ["Attending Doctor", attendingDoctor.user.name],
          ["Specialization", valueOrNotRecorded(attendingDoctor.specialization)],
          ["Daily Room / Bed Rate", Number(admission.dailyRate || bed.dailyRate).toLocaleString("en-PK", { style: "currency", currency: hospital.currency || "PKR" })],
          ["Advance Deposit", Number(admission.depositAmount || 0) > 0
            ? `${Number(admission.depositAmount).toLocaleString("en-PK", { style: "currency", currency: hospital.currency || "PKR" })} (${admission.depositStatus})`
            : "No advance deposit recorded"],
        ]} />
      </PrintSection>

      <PrintSection title="Reason for Admission">
        <p className="careplus-pre-wrap">{valueOrNotRecorded(admission.admissionReason)}</p>
      </PrintSection>

      {admission.admissionNotes && (
        <PrintSection title="Clinical Directives & Admission Notes">
          <p className="careplus-pre-wrap">{admission.admissionNotes}</p>
        </PrintSection>
      )}

      <div className="careplus-print-signatures">
        <div className="careplus-print-signature">
          <div className="careplus-signature-image">{images[1] && <img src={images[1]} alt={`${attendingDoctor.user.name} signature`} />}</div>
          <div className="careplus-signature-line" />
          <strong>{attendingDoctor.user.name}</strong>
          <span>Attending Doctor</span>
        </div>
        <div className="careplus-print-signature">
          <div className="careplus-stamp-image">{images[2] && <img src={images[2]} alt={`${attendingDoctor.user.name} stamp`} />}</div>
          <div className="careplus-signature-line" />
          <span>Doctor Stamp</span>
        </div>
        <div className="careplus-print-signature">
          <div className="careplus-signature-image" />
          <div className="careplus-signature-line" />
          <strong>{printedBy.name}</strong>
          <span>Admitting Officer / Nurse</span>
        </div>
        <div className="careplus-print-signature">
          <div className="careplus-signature-image" />
          <div className="careplus-signature-line" />
          <span>Patient / Attendant Signature</span>
        </div>
      </div>
      <button className="no-print" data-testid="print-data-ready" hidden />
    </DocumentLayout>
  )
}

function PharmacyInvoicePrintPage() {
  const { invoiceId = "", saleId = "" } = useParams()
  const load = React.useCallback(async () => {
    const id = invoiceId || saleId
    const [invoiceData, printedBy, hospital, pharmacySettings] = await Promise.all([
      api.getPharmacyInvoice(id),
      api.me(),
      api.getHospitalProfile(),
      api.getPharmacySettings().catch(() => null),
    ])
    return { invoiceData, printedBy, hospital: hospital ?? DEFAULT_HOSPITAL_PROFILE, pharmacySettings }
  }, [invoiceId, saleId])
  const { data, error } = useDocumentData(load)
  const images = usePrintImages(data ? [data.pharmacySettings?.logoUrl || data.hospital.logoUrl] : null)
  usePrintAfterReady(Boolean(data && images))
  if (error || !data || !images) return <Loading error={error} />
  const { invoiceData, pharmacySettings } = data
  const sale: ApiPharmacySale = {
    id: invoiceData.pharmacySale.id,
    cashierId: invoiceData.pharmacySale.cashier.id,
    cashier: invoiceData.pharmacySale.cashier,
    totalAmount: invoiceData.grandTotal,
    subtotal: invoiceData.subtotal,
    discountAmount: invoiceData.discountAmount,
    taxAmount: invoiceData.taxAmount,
    paymentMethod: invoiceData.pharmacySale.paymentMethod,
    customerName: invoiceData.pharmacySale.customerName,
    customerPhone: invoiceData.pharmacySale.customerPhone,
    items: invoiceData.pharmacySale.items,
    invoice: invoiceData,
  }

  return (
    <div className="p-4 bg-white">
      <InvoicePrintDocument sale={sale} layout="a4" pharmacySettings={pharmacySettings} />
      <button className="no-print" data-testid="print-data-ready" hidden />
    </div>
  )
}

export default function PrintDocuments() {
  return <Routes>
    <Route path="admission/:admissionId" element={<AdmissionSlipPrintPage />} />
    <Route path="admission-slip/:admissionId" element={<AdmissionSlipPrintPage />} />
    <Route path="patient-summary/:patientId" element={<PatientSummaryPrintPage />} />
    <Route path="discharge/:admissionId" element={<DischargePrintPage />} />
    <Route path="discharge-summary/:admissionId" element={<DischargePrintPage />} />
    <Route path="ipd-bill/:admissionId" element={<IpdBillPrintPage />} />
    <Route path="prescription/:consultationId" element={<PrescriptionPrintPage />} />
    <Route path="pharmacy-invoice/:invoiceId" element={<PharmacyInvoicePrintPage />} />
    <Route path="pharmacy/:saleId" element={<PharmacyInvoicePrintPage />} />
    <Route path="*" element={<Loading error="Print document not found." />} />
  </Routes>
}
