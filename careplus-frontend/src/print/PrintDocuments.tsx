import * as React from "react"
import { Route, Routes, useParams } from "react-router-dom"
import { api, loadAuthenticatedImage, type ApiHospitalProfile, type ApiUser } from "@/lib/api"
import { DEFAULT_HOSPITAL_PROFILE } from "@/lib/hospitalProfile"

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
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
  }, [ready])
}

function Loading({ error }: { error: string | null }) {
  return <main className="print-loading" role={error ? "alert" : "status"}>{error ?? "Preparing print document…"}</main>
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
      <button className="careplus-print-action no-print" onClick={() => window.print()}>Print</button>
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
          ["Age / gender", `${valueOrNotRecorded(consultation.patient.age)} / ${valueOrNotRecorded(consultation.patient.gender)}`],
          ["Contact", valueOrNotRecorded(consultation.patient.phone)],
          ["Allergies", consultation.patient.allergies.length ? consultation.patient.allergies.join(", ") : "No known allergies"],
        ]} />
      </PrintSection>
      <PrintSection title="Diagnosis"><p>{valueOrNotRecorded(consultation.diagnosis)}</p></PrintSection>
      <PrintSection title="Vitals">
        <PrintRows rows={[
          ["Blood pressure", `${valueOrNotRecorded(consultation.bpSystolic)} / ${valueOrNotRecorded(consultation.bpDiastolic)} mmHg`],
          ["Pulse", consultation.pulse == null ? "Not recorded" : `${consultation.pulse} /min`],
          ["Temperature", consultation.temperature == null ? "Not recorded" : `${consultation.temperature} °${consultation.temperatureUnit ?? "F"}`],
          ["Respiratory rate", consultation.respiratoryRate == null ? "Not recorded" : `${consultation.respiratoryRate} /min`],
          ["Weight", consultation.weight == null ? "Not recorded" : `${consultation.weight} kg`],
          ["SpO2", consultation.oxygenSaturation == null ? "Not recorded" : `${consultation.oxygenSaturation}%`],
          ["Height", consultation.heightCm == null ? "Not recorded" : `${consultation.heightCm} cm`],
        ]} />
        {consultation.vitalsEstimated && <p>(estimated)</p>}
      </PrintSection>
      <PrintSection title="Medicines">
        {prescriptionRecord.items.length ? <table><thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>
          {prescriptionRecord.items.map((item) => <tr key={item.id}><td>{item.medicineName}</td><td>{item.dosage}</td><td>{valueOrNotRecorded(item.route)}</td><td>{item.frequency}</td><td>{item.durationValue ?? item.durationDays} {item.durationUnit ?? "days"}</td><td>{valueOrNotRecorded(item.instructions)}</td></tr>)}
        </tbody></table> : <p>Not recorded</p>}
      </PrintSection>
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

export default function PrintDocuments() {
  return <Routes>
    <Route path="patient-summary/:patientId" element={<PatientSummaryPrintPage />} />
    <Route path="discharge/:admissionId" element={<DischargePrintPage />} />
    <Route path="prescription/:consultationId" element={<PrescriptionPrintPage />} />
    <Route path="*" element={<Loading error="Print document not found." />} />
  </Routes>
}
