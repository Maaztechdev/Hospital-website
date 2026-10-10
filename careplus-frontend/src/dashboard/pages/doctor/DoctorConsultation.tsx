import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { AlertTriangle, Plus, Trash2, Lock, Printer, Save, PenLine, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatBloodGroup, generateId, formatDate, getHospitalDateKey } from "@/dashboard/lib/format"
import type { Consultation, PrescriptionItem, VitalSigns } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { NotPermitted } from "@/dashboard/components/Layout"
import { cn } from "@/lib/utils"
import { api, apiAssetUrl, getAccessToken, type ApiConsultation, type ApiError, type ApiLabTest, type ApiMedicine, type ApiPrescription } from "@/lib/api"
import { useHospitalProfile } from "@/lib/hospitalProfile"
import QRCode from "qrcode"

export default function DoctorConsultation() {
  const { appointmentId: routeAppointmentId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { patients, appointments, consultations, dispatch, currentUser } = useDashboard()
  const hospitalProfile = useHospitalProfile()

  const mrNumber = params.get("mr") ?? ""
  const patient = patients.find((p) => p.mrNumber === mrNumber)
  const [activeAppointmentId, setActiveAppointmentId] = React.useState(routeAppointmentId === "new" ? null : routeAppointmentId ?? null)
  const appointment = appointments.find((a) => a.id === activeAppointmentId)
  const existing = consultations.find((c) => c.appointmentId === activeAppointmentId)
  const [remoteConsultation, setRemoteConsultation] = React.useState<ApiConsultation | null>(null)
  const [remotePrescription, setRemotePrescription] = React.useState<ApiPrescription | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [requestError, setRequestError] = React.useState<string | null>(null)
  const [retryKey, setRetryKey] = React.useState(0)
  const prescriptionLoadId = React.useRef<string | null>(null)

  const [vitals, setVitals] = React.useState<VitalSigns>(existing?.vitals ?? { bp: "", temperature: "", pulse: "", weight: "", spo2: "", respiratoryRate: "" })
  const [chiefComplaint, setChiefComplaint] = React.useState(existing?.chiefComplaint ?? "")
  const [clinicalNotes, setClinicalNotes] = React.useState(existing?.clinicalNotes ?? "")
  const [diagnosis, setDiagnosis] = React.useState(existing?.diagnosis ?? "")
  const [findings, setFindings] = React.useState("")
  const [refillNumber, setRefillNumber] = React.useState(0)
  const [doctorProfile, setDoctorProfile] = React.useState<{ qualification?: string | null; specialization?: string | null; registrationNumber?: string | null; signatureUrl?: string | null; stampUrl?: string | null } | null>(null)
  const [prescriptions, setPrescriptions] = React.useState<PrescriptionItem[]>(existing?.prescriptions ?? [])
  const [labRecs, setLabRecs] = React.useState<string[]>(existing?.labRecommendations ?? [])
  const [followUp, setFollowUp] = React.useState(existing?.followUpDate ?? "")
  const [referral, setReferral] = React.useState(existing?.referral ?? "")
  const [status, setStatus] = React.useState<Consultation["status"]>(existing?.status ?? "Draft")
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [autocompleteIdx, setAutocompleteIdx] = React.useState<number | null>(null)
  const [completed, setCompleted] = React.useState(false)
  const [medicineSearch, setMedicineSearch] = React.useState("")
  const [medicines, setMedicines] = React.useState<ApiMedicine[]>([])
  const [labTests, setLabTests] = React.useState<ApiLabTest[]>([])
  const [ultrasoundRecs, setUltrasoundRecs] = React.useState<string[]>([])
  const ultrasoundTypes = ["Abdominal", "Obstetric", "Pelvic", "Renal"]

  React.useEffect(() => {
    setRequestError(null)
    setLoading(true)
    if (routeAppointmentId === "new" && !activeAppointmentId) {
      if (!patient?.id) { setRequestError("The selected patient could not be found."); setLoading(false); return }
      api.startPatientConsultation(patient.id)
        .then((item) => { setActiveAppointmentId(item.appointmentId); setRemoteConsultation(item) })
        .catch((error: ApiError) => setRequestError(error.message || "Unable to start consultation"))
        .finally(() => setLoading(false))
      return
    }
    if (!activeAppointmentId) { setRequestError("No appointment was supplied for this consultation."); setLoading(false); return }
    api.listConsultations(activeAppointmentId)
      .then((items) => setRemoteConsultation(items[0] ?? null))
      .catch((error: ApiError) => setRequestError(error.message || "Unable to load consultation"))
      .finally(() => setLoading(false))
  }, [activeAppointmentId, patient?.id, routeAppointmentId, retryKey])

  React.useEffect(() => {
    void Promise.all([api.listLabTests(), api.listMedicines()]).then(([tests, medicineList]) => { setLabTests(tests); setMedicines(medicineList) }).catch((error: ApiError) => setRequestError(error.message || "Unable to load clinical catalogs"))
  }, [])

  React.useEffect(() => {
    if (currentUser?.role === "doctor") {
      void api.getMyStaffProfile().then((result) => setDoctorProfile(result.profile)).catch((cause) => setRequestError(cause instanceof Error ? cause.message : "Unable to load doctor profile"))
    }
  }, [currentUser?.role])

  React.useEffect(() => {
    if (!medicineSearch.trim()) { setMedicines([]); return }
    const timer = window.setTimeout(() => void api.listMedicines(medicineSearch.trim()).then(setMedicines).catch((cause) => { setMedicines([]); setRequestError(cause instanceof Error ? cause.message : "Unable to search medicines") }), 250)
    return () => window.clearTimeout(timer)
  }, [medicineSearch])

  React.useEffect(() => {
    if (!remoteConsultation) return
    if (prescriptionLoadId.current === remoteConsultation.id) return
    prescriptionLoadId.current = remoteConsultation.id
    api.listPrescriptions().then((items) => {
      const prescription = items.find((item) => item.consultationId === remoteConsultation.id) ?? null
      setRemotePrescription(prescription)
      if (prescription) {
        setPrescriptions(prescription.items.map((item) => ({
          id: item.id,
          medicine: item.medicineName,
          medicineId: item.medicineId ?? undefined,
          dosage: item.dosage ?? "",
          route: item.route ?? "Oral",
          frequency: item.frequency ?? "",
          duration: String(item.durationDays),
          instructions: item.instructions ?? "",
        })))
        setRefillNumber(prescription.refillNumber ?? 0)
      }
    }).catch((cause) => setRequestError(cause instanceof Error ? cause.message : "Unable to load prescriptions"))
  }, [remoteConsultation])

  React.useEffect(() => {
    if (!remoteConsultation) return
    const remoteVitals = remoteConsultation.vitalsJson ?? {}
    setVitals({ bp: remoteVitals.bp_systolic && remoteVitals.bp_diastolic ? `${remoteVitals.bp_systolic}/${remoteVitals.bp_diastolic}` : "", temperature: remoteVitals.temperature?.toString() ?? "", pulse: remoteVitals.pulse?.toString() ?? "", weight: remoteVitals.weight?.toString() ?? "", spo2: remoteVitals.oxygen_saturation?.toString() ?? "", respiratoryRate: remoteVitals.respiratory_rate?.toString() ?? "" })
    setChiefComplaint(remoteConsultation.chiefComplaint ?? "")
    setClinicalNotes(remoteConsultation.clinicalNotes ?? "")
    setDiagnosis(remoteConsultation.diagnosis ?? "")
    setFindings(remoteConsultation.findings ?? "")
    setFollowUp(remoteConsultation.followUpDate?.slice(0, 10) ?? "")
    setReferral(remoteConsultation.referral ?? "")
    setStatus(remoteConsultation.prescriptionStatus === "DRAFT" ? "Draft" : "Signed")
    setCompleted(remoteConsultation.prescriptionStatus === "COMPLETED")
  }, [remoteConsultation])

  if (!patient) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardPageHeader title="Start Consultation" />
        <Card><CardContent className="p-6 text-sm text-[var(--cp-ink-soft)]">Select a patient from the Patients list or Doctor dashboard to begin a consultation.</CardContent></Card>
      </div>
    )
  }

  const locked = status === "Signed" || (remoteConsultation !== null && remoteConsultation.prescriptionStatus !== "DRAFT")

  if (loading) return <Card><CardContent className="p-6 text-sm text-[var(--cp-ink-soft)]">Loading consultation...</CardContent></Card>
  if (requestError) return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <p role="alert" className="text-sm text-[var(--cp-critical)]">{requestError}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setRetryKey((key) => key + 1)}>Retry</Button>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>Go Back to Dashboard</Button>
        </div>
      </CardContent>
    </Card>
  )

  function addPrescriptionRow() {
    setPrescriptions((p) => [...p, { id: generateId("rx"), medicine: "", dosage: "", route: "Oral", frequency: "", duration: "", instructions: "" }])
  }
  function updateRow(id: string, patch: Partial<PrescriptionItem>) {
    setPrescriptions((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRow(id: string) {
    setPrescriptions((p) => p.filter((r) => r.id !== id))
  }
  function toggleLab(test: string) {
    setLabRecs((l) => (l.includes(test) ? l.filter((t) => t !== test) : [...l, test]))
  }
  function toggleUltrasound(type: string) {
    setUltrasoundRecs((items) => items.includes(type) ? items.filter((item) => item !== type) : [...items, type])
  }

  function buildConsultation(finalStatus: Consultation["status"]): Consultation {
    return {
      id: existing?.id ?? generateId("cons"),
      appointmentId: activeAppointmentId ?? "",
      mrNumber: patient!.mrNumber,
      patientName: patient!.name,
      doctorId: appointment?.doctorId ?? "",
      doctorName: appointment?.doctorName ?? "",
      date: existing?.date ?? new Date().toISOString(),
      vitals, chiefComplaint, clinicalNotes, diagnosis, prescriptions, labRecommendations: labRecs,
      followUpDate: followUp || undefined, referral: referral || undefined,
      status: finalStatus,
      signedAt: finalStatus === "Signed" ? new Date().toISOString() : existing?.signedAt,
    }
  }

  function consultationPayload() {
    const [systolic, diastolic] = vitals.bp.split("/").map(Number)
    const numeric = (value: string) => value ? Number(value) : undefined
    return { appointmentId: activeAppointmentId ?? "", chiefComplaint: chiefComplaint || undefined, vitals: { bp_systolic: systolic || undefined, bp_diastolic: diastolic || undefined, temperature: numeric(vitals.temperature), pulse: numeric(vitals.pulse), weight: numeric(vitals.weight), oxygen_saturation: numeric(vitals.spo2), respiratory_rate: numeric(vitals.respiratoryRate) }, diagnosis: diagnosis || undefined, findings: findings || undefined, clinicalNotes: clinicalNotes || undefined, followUpDate: followUp || undefined, referral: referral || undefined }
  }

  async function createLinkedOrders(consultationId: string) {
    const patientId = patient?.id
    if (!patientId) return
    const [existingLabs, ultrasoundOrders] = await Promise.all([api.listLabOrders(), api.listUltrasoundOrders()])
    const existingLabIds = new Set(existingLabs.filter((order) => order.consultationId === consultationId).map((order) => order.testId))
    const existingUltrasounds = new Set(ultrasoundOrders.filter((order) => order.consultationId === consultationId).map((order) => order.examType))
    await Promise.all([
      ...labRecs.filter((testId) => !existingLabIds.has(testId)).map((testId) => api.createLabOrder({ patientId, testId, clinicalNotes: diagnosis || chiefComplaint || undefined, consultationId })),
      ...ultrasoundRecs.filter((examType) => !existingUltrasounds.has(examType)).map((examType) => api.createUltrasoundOrder({ patientId, examType, notes: diagnosis || chiefComplaint || undefined, consultationId })),
    ])
  }

  async function saveDraft() {
    try {
      const saved = remoteConsultation ? await api.updateConsultation(remoteConsultation.id, consultationPayload()) : await api.createConsultation(consultationPayload())
      setRemoteConsultation(saved)
      await createLinkedOrders(saved.id)
      setStatus("Draft")
      toast({ title: "Draft saved", variant: "success" })
    } catch (error) { toast({ title: "Draft save failed", description: (error as ApiError).message, variant: "error" }) }
  }

  async function signPrescription() {
    try {
      if (prescriptions.length === 0 || prescriptions.some((item) => !item.medicine.trim() || !item.dosage.trim() || !item.frequency.trim() || !Number.parseInt(item.duration, 10))) {
        toast({ title: "Prescription details required", description: "Add a medicine, dosage, frequency, and duration before signing.", variant: "error" })
        return
      }
      const consultation = remoteConsultation ?? await api.createConsultation(consultationPayload())
      if (!remoteConsultation) setRemoteConsultation(consultation)
      await createLinkedOrders(consultation.id)
      const existingPrescription = remotePrescription ?? (await api.listPrescriptions()).find((item) => item.consultationId === consultation.id)
      const prescription = existingPrescription ?? await api.createPrescription({
        consultationId: consultation.id,
        padData: { visitNumber: appointment?.token?.toString(), visitDate: getHospitalDateKey(), visitTime: appointment?.time, relationship: "", patientAddress: patient!.address, patientContact: patient!.phone, patientAge: patient!.age, patientGender: patient!.gender.toUpperCase() as "MALE" | "FEMALE" | "OTHER", patientWeight: vitals.weight, vitals: { bp: vitals.bp, pulse: vitals.pulse, temperature: vitals.temperature, respiratory_rate: vitals.respiratoryRate, weight: vitals.weight }, allergies: patient!.allergies.join(", "), presentingComplaints: chiefComplaint, history: patient!.notes, findings, investigations: [...labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id), ...ultrasoundRecs].join(", "), refillNumber },
        items: prescriptions.map((item) => ({ medicineId: item.medicineId, medicineName: item.medicine.trim(), dosage: item.dosage.trim(), route: item.route, frequency: item.frequency.trim(), durationDays: Number.parseInt(item.duration, 10), instructions: item.instructions?.trim() || undefined })),
      })
      const signedPrescription = prescription.status === "DRAFT" ? await api.signPrescription(prescription.id) : prescription
      setRemotePrescription(signedPrescription)
      const saved = consultation.prescriptionStatus === "DRAFT" ? await api.signConsultation(consultation.id) : consultation
      setRemoteConsultation(saved)
      setStatus("Signed")
      toast({ title: "Prescription signed", description: "The signed prescription is now available to Pharmacy.", variant: "success" })
    } catch (error) { toast({ title: "Sign failed", description: (error as ApiError).message, variant: "error" }) }
  }

  async function completeConsultation() {
    if (status !== "Signed") { toast({ title: "Sign the prescription first", description: "The consultation can be completed after signing.", variant: "error" }); return }
    if (!remoteConsultation) { toast({ title: "Save the consultation first", description: "The consultation record is not available yet.", variant: "error" }); return }
    try {
      await api.completeConsultation(remoteConsultation.id)
    } catch (error) {
      toast({ title: "Completion failed", description: (error as ApiError).message, variant: "error" })
      return
    }
    const c = buildConsultation("Signed")
    dispatch({ type: "SAVE_CONSULTATION", consultation: c })
    if (activeAppointmentId) dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: activeAppointmentId, status: "Done" })
    dispatch({
      type: "ADD_TIMELINE_EVENT",
      event: { id: generateId("tl"), mrNumber: patient!.mrNumber, stage: "OPD Consultation", datetime: new Date().toISOString(), department: appointment?.department ?? "OPD", staff: appointment?.doctorName ?? "Doctor", status: "Completed", details: diagnosis || "Consultation completed." },
    })
    toast({ title: "Consultation completed", description: `${patient!.name}'s visit has been marked done.`, variant: "success" })
    setCompleted(true)
  }

  async function printPrescription() {
    if (!completed || status !== "Signed") return
    const currentPatient = patient
    if (!currentPatient) return
    const prescription = remotePrescription
    const refNo = prescription?.id ?? remoteConsultation?.id ?? activeAppointmentId ?? "PRESCRIPTION"
    const qrCode = await QRCode.toDataURL(refNo, { width: 150, margin: 1 })
    const esc = (value: unknown) => String(value ?? "-").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character)
    const value = (text: unknown) => esc(text || "-")
    const items = remotePrescription?.items ?? prescriptions
    const rows = items.map((item) => {
      const remoteItem = "medicineName" in item
      const medicineName = remoteItem ? item.medicineName : item.medicine
      const dosage = item.dosage ?? ""
      const frequency = item.frequency ?? ""
      const duration = remoteItem ? (item.durationDays ? `${item.durationDays} days` : "") : item.duration
      return `<tr><td><strong>${value(medicineName)}</strong><br><small>${value(item.route)}</small></td><td>${value(dosage)}</td><td>${value(frequency)}</td><td>${value(duration)}</td><td>${value(item.instructions)}</td></tr>`
    }).join("")
    const tests = labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id).join(", ")
    const ultrasound = ultrasoundRecs.join(", ")
    const signedAt = prescription?.signedAt ?? remoteConsultation?.signedAt ?? new Date().toISOString()
    const doctorName = currentUser?.name ?? appointment?.doctorName ?? "Doctor"
    const relationship = currentPatient.emergencyContact ? `S/o D/o W/o: ${currentPatient.emergencyContact}` : ""
    const assetDataUrl = async (url?: string | null) => {
      if (!url) return null
      try {
        const accessToken = getAccessToken()
        const response = await fetch(apiAssetUrl(url), { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined })
        if (!response.ok) return null
        const blob = await response.blob()
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    }
    const [signatureDataUrl, stampDataUrl] = await Promise.all([assetDataUrl(doctorProfile?.signatureUrl), assetDataUrl(doctorProfile?.stampUrl)])
    const profileImage = (dataUrl: string, alt: string) => `<img class="profile-image" src="${esc(dataUrl)}" alt="${esc(alt)}">`
    const dispensingStamp = hospitalProfile.dispensingStampText?.trim()
    const signatureBlocks = [
      signatureDataUrl ? `<div class="signature">${profileImage(signatureDataUrl, "Doctor signature")}<small>Doctor's Signature</small></div>` : "",
      stampDataUrl ? `<div class="signature">${profileImage(stampDataUrl, "Doctor stamp")}<small>Doctor's Stamp</small></div>` : "",
    ].filter(Boolean).join("")
    const printWindow = window.open("", "_blank", "width=900,height=1000")
    if (!printWindow) return

    const triggerPrint = () => {
      const images = Array.from(printWindow.document.images)
      if (images.length === 0) {
        printWindow.focus()
        printWindow.print()
        return
      }

      let remaining = images.length
      const finalize = () => {
        remaining -= 1
        if (remaining <= 0) {
          printWindow.focus()
          printWindow.print()
        }
      }

      images.forEach((image) => {
        if (image.complete) {
          finalize()
          return
        }
        image.addEventListener("load", finalize, { once: true })
        image.addEventListener("error", finalize, { once: true })
      })
    }

    printWindow.document.write(`<html><head><title>Prescription - ${value(currentPatient.name)}</title><style>
      @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17212b;margin:0;font-size:11px;line-height:1.35}.sheet{max-width:190mm;margin:auto}.header{display:grid;grid-template-columns:1fr 1fr;gap:18px;border-bottom:2px solid #1d6b63;padding-bottom:10px}.hospital h1{font-size:24px;color:#1d6b63;margin:0 0 4px}.hospital p,.doctor p{margin:2px 0}.doctor{text-align:right}.doctor h2{font-size:16px;margin:0 0 3px;color:#1d6b63}.qr{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:5px}.qr img{width:58px;height:58px}.ref{font-size:9px;word-break:break-all}.patient-bar{margin:10px 0;padding:8px 10px;background:#e7f3f1;border:1px solid #acd3cd;border-radius:3px;display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px}.patient-bar strong{color:#0f554e}.columns{display:grid;grid-template-columns:34% 66%;gap:14px;margin-top:10px}.section{margin-bottom:11px}.section h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#1d6b63;border-bottom:1px solid #b9cfcc;padding-bottom:3px;margin:0 0 5px}.section p{margin:3px 0;white-space:pre-wrap}.vitals{display:grid;grid-template-columns:1fr 1fr;gap:3px}.vital{border:1px solid #d5e2e0;padding:4px}.vital b{display:block;font-size:9px;color:#55706d}.rx-table{width:100%;border-collapse:collapse}.rx-table th,.rx-table td{text-align:left;border-bottom:1px solid #d5e2e0;padding:5px 4px;vertical-align:top}.rx-table th{background:#f0f6f5;font-size:10px}.rx-table small{color:#55706d}.footer{border-top:1px solid #b9cfcc;margin-top:16px;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:20px}.stamp-box{height:70px;width:150px;border:1px dashed #91aaa6;display:flex;align-items:center;justify-content:center;color:#718784;font-size:10px}.signatures{display:flex;justify-content:flex-end;gap:18px;text-align:center}.signature{min-width:105px}.profile-image{height:55px;max-width:125px;object-fit:contain;display:block;margin:auto}.signature-line{height:55px;border-bottom:1px solid #7f9995}.bottom{grid-column:1/-1;border-top:1px solid #d5e2e0;margin-top:5px;padding-top:6px;display:flex;justify-content:space-between;gap:12px;font-size:10px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body><main class="sheet">
      <header class="header"><div class="hospital">${hospitalProfile.logoUrl ? `<img src="${esc(apiAssetUrl(hospitalProfile.logoUrl))}" alt="" style="max-height:42px;max-width:150px;object-fit:contain">` : ""}<h1>${value(hospitalProfile.name)}</h1><p>${value(hospitalProfile.address)}</p><p>${value(hospitalProfile.phone)}${hospitalProfile.email ? ` | ${value(hospitalProfile.email)}` : ""}</p><p>PM&DC Reg No.: ${value(hospitalProfile.pmdcRegistrationNo)} | PHC Reg No.: ${value(hospitalProfile.phcRegistrationNo)} | PHC RL No.: ${value(hospitalProfile.phcRlNo)}</p></div><div class="doctor"><h2>${value(doctorName)}</h2><p>${value(doctorProfile?.qualification)}</p><p>${value(doctorProfile?.specialization)}</p><div class="qr"><div class="ref">Ref No.<br><strong>${value(refNo)}</strong></div><img src="${qrCode}" alt="Verification QR code"></div></div></header>
      <section class="patient-bar"><div><strong>Patient:</strong> ${value(currentPatient.name)}</div><div><strong>${value(relationship)}</strong></div><div><strong>Visit No.:</strong> ${value(appointment?.token)}</div><div><strong>Date:</strong> ${value(formatDate(appointment?.date ?? new Date().toISOString()))}</div><div><strong>Time:</strong> ${value(appointment?.time)}</div><div><strong>Address:</strong> ${value(currentPatient.address)}</div><div><strong>Contact:</strong> ${value(currentPatient.phone)}</div><div><strong>MR No.:</strong> ${value(currentPatient.mrNumber)}</div></section>
      <div class="columns"><aside><section class="section"><h3>Vitals</h3><div class="vitals"><div class="vital"><b>BP</b>${value(vitals.bp)}</div><div class="vital"><b>Pulse</b>${value(vitals.pulse)}</div><div class="vital"><b>Temperature</b>${value(vitals.temperature)}</div><div class="vital"><b>RR</b>${value(vitals.respiratoryRate)}</div><div class="vital"><b>Weight</b>${value(vitals.weight)}</div><div class="vital"><b>SpO2</b>${value(vitals.spo2)}</div></div></section><section class="section"><h3>Allergies</h3><p>${value(currentPatient.allergies.join(", "))}</p></section><section class="section"><h3>Presenting Complaints</h3><p>${value(chiefComplaint)}</p></section><section class="section"><h3>History</h3><p>${value(currentPatient.notes)}</p></section><section class="section"><h3>Findings</h3><p>${value(findings)}</p></section><section class="section"><h3>Investigations</h3><p>${value([tests, ultrasound].filter(Boolean).join(", "))}</p></section></aside><section><section class="section"><h3>Patient Assessment</h3><p><strong>Age:</strong> ${value(currentPatient.age)} &nbsp; <strong>Gender:</strong> ${value(currentPatient.gender)} &nbsp; <strong>Weight:</strong> ${value(vitals.weight)}</p></section><section class="section"><h3>Provisional / Diagnosis</h3><p>${value(diagnosis)}</p></section><section class="section"><h3>Rx</h3><table class="rx-table"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No medicines prescribed</td></tr>`}</tbody></table></section></section></div>
      <footer class="footer">${dispensingStamp ? `<div><p><strong>Dispensing Stamp</strong></p><div class="stamp-box">${value(dispensingStamp)}</div></div>` : ""}${signatureBlocks ? `<div class="signatures">${signatureBlocks}</div>` : ""}<div class="bottom"><span>${value(hospitalProfile.refillText || `Refills: ${refillNumber}`)} | Refill selected: ${refillNumber}</span><span>${value(hospitalProfile.phone)} | ${value(hospitalProfile.clinicDaysTimings)}</span><span>Signed: ${value(new Date(signedAt).toLocaleString())}</span></div></footer>
    </main><script>window.onload=()=>window.print()</script></body></html>`)
    printWindow.document.close()
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Consultation"
        action={
          <Button variant="outline" size="sm" disabled={!completed || status !== "Signed"} onClick={printPrescription}>
            <Printer className="h-4 w-4" /> Print Prescription
          </Button>
        }
      />

      {/* Patient summary strip */}
      <Card className={cn(patient.allergies.length > 0 && "border-[var(--cp-critical)]")}>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--cp-ink)]">{patient.name} <span className="cp-tabular font-normal text-[var(--cp-ink-soft)]">· {patient.mrNumber} · {patient.age} yrs, {patient.gender}</span></p>
            </div>
            {patient.allergies.length > 0 ? (
              <div className="flex items-center gap-1.5 rounded-full border-2 border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-3 py-1.5 text-xs font-bold text-[var(--cp-critical)]">
                <AlertTriangle className="h-4 w-4" /> ALLERGIES: {patient.allergies.join(", ")}
              </div>
            ) : (
              <span className="text-xs text-[var(--cp-ink-soft)]">No known allergies</span>
            )}
          </div>
          <button onClick={() => setHistoryOpen((v) => !v)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-[var(--cp-primary)]">
            Previous visits / medical history {historyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {historyOpen && (
            <div className="mt-2 rounded-lg bg-[var(--cp-bg)] p-3 text-sm text-[var(--cp-ink-soft)]">
              {patient.lastVisit ? `Last visit on ${formatDate(patient.lastVisit)}.` : "No previous visits recorded."} Blood group {formatBloodGroup(patient.bloodGroup)}. {patient.notes ?? ""}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vitals */}
      <Card>
        <CardHeader><CardTitle>Vitals</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-6">
          {([["bp", "BP (mmHg)"], ["pulse", "Pulse (bpm)"], ["temperature", "Temp (°F)"], ["respiratoryRate", "RR (/min)"], ["weight", "Weight (kg)"], ["spo2", "SpO2 (%)"]] as [keyof VitalSigns, string][]).map(([key, label]) => (
            <div key={key} className="min-w-0">
              <Label className="text-xs" htmlFor={`v-${key}`}>{label}</Label>
              <Input id={`v-${key}`} disabled={locked} value={vitals[key]} onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Clinical notes */}
      <Card>
        <CardHeader><CardTitle>Clinical Notes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cc">Chief Complaint</Label>
            <Textarea id="cc" disabled={locked} value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dx">Diagnosis</Label>
            <Textarea id="dx" disabled={locked} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="findings">Findings</Label>
            <Textarea id="findings" disabled={locked} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Examination findings" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Clinical Notes</Label>
            <Textarea id="notes" disabled={locked} value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Prescription builder */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            Prescription
            {locked && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cp-success-light)] px-2 py-0.5 text-xs font-semibold text-[var(--cp-success)]"><Lock className="h-3 w-3" /> Signed &amp; Locked</span>}
          </CardTitle>
          {!locked && <Button variant="outline" size="sm" onClick={addPrescriptionRow}><Plus className="h-4 w-4" /> Add Medicine</Button>}
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-xs"><Label htmlFor="refill-number">Refill Number</Label><Select id="refill-number" disabled={locked} value={String(refillNumber)} onChange={(event) => setRefillNumber(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</Select></div>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-[var(--cp-ink-soft)]">No medicines added yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {prescriptions.map((row, idx) => (
                <div key={row.id} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-[var(--cp-border)] p-3 sm:grid-cols-6", locked && "bg-[var(--cp-bg)]")}>
                  <div className="relative sm:col-span-2">
                    <Label>Medicine</Label>
                    <Input
                      disabled={locked}
                      value={row.medicine}
                      onChange={(e) => { updateRow(row.id, { medicine: e.target.value, medicineId: undefined }); setMedicineSearch(e.target.value); setAutocompleteIdx(idx) }}
                      onFocus={() => setAutocompleteIdx(idx)}
                      onBlur={() => setTimeout(() => setAutocompleteIdx(null), 150)}
                      placeholder="Start typing…"
                    />
                    {autocompleteIdx === idx && row.medicine && medicines.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-lg">
                        {medicines.map((medicine) => { const stock = medicine.batches.reduce((total, batch) => total + batch.stockQuantity, 0); return <li key={medicine.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--cp-primary-light)]" onMouseDown={(e) => e.preventDefault()} onClick={() => { updateRow(row.id, { medicine: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`, medicineId: medicine.id }); setAutocompleteIdx(null) }}><span className="font-semibold">{medicine.name}</span>{medicine.strength && ` ${medicine.strength}`} <span className={cn("float-right text-xs", stock ? "text-[var(--cp-success)]" : "text-[var(--cp-critical)]")}>{stock ? `${stock} in stock` : "Not in stock"}</span></button></li> })}
                      </ul>
                    )}
                  </div>
                  <div><Label>Dosage</Label><Input disabled={locked} value={row.dosage} onChange={(e) => updateRow(row.id, { dosage: e.target.value })} placeholder="1 tablet" /></div>
                  <div><Label>Route</Label>
                    <Select disabled={locked} value={row.route} onChange={(e) => updateRow(row.id, { route: e.target.value })}>
                      <option>Oral</option><option>IV</option><option>IM</option><option>Topical</option><option>Inhalation</option>
                    </Select>
                  </div>
                  <div><Label>Frequency</Label><Input disabled={locked} value={row.frequency} onChange={(e) => updateRow(row.id, { frequency: e.target.value })} placeholder="Twice daily" /></div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1"><Label>Duration</Label><Input disabled={locked} value={row.duration} onChange={(e) => updateRow(row.id, { duration: e.target.value })} placeholder="5 days" /></div>
                    {!locked && <button onClick={() => removeRow(row.id)} aria-label="Remove row" className="mb-0.5 rounded-lg p-2 text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <div className="sm:col-span-6"><Label>Instructions</Label><Input disabled={locked} value={row.instructions} onChange={(e) => updateRow(row.id, { instructions: e.target.value })} placeholder="Take after meals" /></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lab recommendations */}
      <Card>
        <CardHeader><CardTitle>Suggest Lab Tests</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {labTests.map((test) => (
            <button
              key={test.id}
              type="button"
              disabled={locked}
              onClick={() => toggleLab(test.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                labRecs.includes(test.id) ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)] hover:border-[var(--cp-primary)]"
              )}
            >
              {test.testName}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Suggest Ultrasound</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ultrasoundTypes.map((type) => <button key={type} type="button" disabled={locked} onClick={() => toggleUltrasound(type)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", ultrasoundRecs.includes(type) ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]")}>{type}</button>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Follow-up &amp; Referral</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label htmlFor="fu">Follow-up Date</Label><Input id="fu" type="date" disabled={locked} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></div>
          <div><Label htmlFor="ref">Referral</Label><Input id="ref" disabled={locked} value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="e.g. Refer to Nephrology" /></div>
        </CardContent>
      </Card>

      <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 cp-shadow print:hidden">
        <Button variant="outline" size="sm" onClick={saveDraft} disabled={locked}><Save className="h-4 w-4" /> Save Draft</Button>
        <Button variant="outline" size="sm" onClick={signPrescription} disabled={locked}><PenLine className="h-4 w-4" /> Sign Prescription</Button>
        <Button size="sm" onClick={completeConsultation} disabled={completed}><CheckCircle2 className="h-4 w-4" /> {completed ? "Consultation Completed" : "Complete Consultation"}</Button>
      </div>
    </div>
  )
}
