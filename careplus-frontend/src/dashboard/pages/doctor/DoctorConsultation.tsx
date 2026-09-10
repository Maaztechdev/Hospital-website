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
import { generateId, formatDate } from "@/dashboard/lib/format"
import type { Consultation, PrescriptionItem, VitalSigns } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { NotPermitted } from "@/dashboard/components/Layout"
import { cn } from "@/lib/utils"
import { api, type ApiConsultation, type ApiError, type ApiLabTest, type ApiMedicine, type ApiPrescription } from "@/lib/api"

export default function DoctorConsultation() {
  const { appointmentId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { patients, appointments, consultations, dispatch } = useDashboard()

  const mrNumber = params.get("mr") ?? ""
  const patient = patients.find((p) => p.mrNumber === mrNumber)
  const appointment = appointments.find((a) => a.id === appointmentId)
  const existing = consultations.find((c) => c.appointmentId === appointmentId)
  const [remoteConsultation, setRemoteConsultation] = React.useState<ApiConsultation | null>(null)
  const [remotePrescription, setRemotePrescription] = React.useState<ApiPrescription | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [requestError, setRequestError] = React.useState<string | null>(null)

  const [vitals, setVitals] = React.useState<VitalSigns>(existing?.vitals ?? { bp: "", temperature: "", pulse: "", weight: "", spo2: "" })
  const [chiefComplaint, setChiefComplaint] = React.useState(existing?.chiefComplaint ?? "")
  const [clinicalNotes, setClinicalNotes] = React.useState(existing?.clinicalNotes ?? "")
  const [diagnosis, setDiagnosis] = React.useState(existing?.diagnosis ?? "")
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
    if (!appointmentId) return
    api.listConsultations(appointmentId)
      .then((items) => setRemoteConsultation(items[0] ?? null))
      .catch((error: ApiError) => setRequestError(error.message || "Unable to load consultation"))
      .finally(() => setLoading(false))
  }, [appointmentId])

  React.useEffect(() => {
    void Promise.all([api.listLabTests(), api.listMedicines()]).then(([tests, medicineList]) => { setLabTests(tests); setMedicines(medicineList) }).catch((error: ApiError) => setRequestError(error.message || "Unable to load clinical catalogs"))
  }, [])

  React.useEffect(() => {
    if (!medicineSearch.trim()) { setMedicines([]); return }
    const timer = window.setTimeout(() => void api.listMedicines(medicineSearch.trim()).then(setMedicines).catch(() => setMedicines([])), 250)
    return () => window.clearTimeout(timer)
  }, [medicineSearch])

  React.useEffect(() => {
    if (!remoteConsultation) return
    api.listPrescriptions().then((items) => setRemotePrescription(items.find((item) => item.consultationId === remoteConsultation.id) ?? null)).catch(() => undefined)
  }, [remoteConsultation])

  React.useEffect(() => {
    if (!remoteConsultation) return
    const remoteVitals = remoteConsultation.vitalsJson ?? {}
    setVitals({ bp: remoteVitals.bp_systolic && remoteVitals.bp_diastolic ? `${remoteVitals.bp_systolic}/${remoteVitals.bp_diastolic}` : "", temperature: remoteVitals.temperature?.toString() ?? "", pulse: remoteVitals.pulse?.toString() ?? "", weight: remoteVitals.weight?.toString() ?? "", spo2: remoteVitals.oxygen_saturation?.toString() ?? "" })
    setChiefComplaint(remoteConsultation.chiefComplaint ?? "")
    setClinicalNotes(remoteConsultation.clinicalNotes ?? "")
    setDiagnosis(remoteConsultation.diagnosis ?? "")
    setFollowUp(remoteConsultation.followUpDate?.slice(0, 10) ?? "")
    setReferral(remoteConsultation.referral ?? "")
    setStatus(remoteConsultation.prescriptionStatus === "DRAFT" ? "Draft" : "Signed")
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
  if (requestError) return <Card><CardContent className="p-6"><p role="alert" className="text-sm text-[var(--cp-critical)]">{requestError}</p></CardContent></Card>

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
      appointmentId: appointmentId ?? "new",
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
    return { appointmentId: appointmentId ?? "", chiefComplaint: chiefComplaint || undefined, vitals: { bp_systolic: systolic || undefined, bp_diastolic: diastolic || undefined, temperature: numeric(vitals.temperature), pulse: numeric(vitals.pulse), weight: numeric(vitals.weight), oxygen_saturation: numeric(vitals.spo2) }, diagnosis: diagnosis || undefined, clinicalNotes: clinicalNotes || undefined, followUpDate: followUp || undefined, referral: referral || undefined }
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

  function completeConsultation() {
    if (status !== "Signed") { toast({ title: "Sign the prescription first", description: "The consultation can be completed after signing.", variant: "error" }); return }
    const c = buildConsultation(status)
    dispatch({ type: "SAVE_CONSULTATION", consultation: c })
    if (appointmentId) dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: appointmentId, status: "Done" })
    dispatch({
      type: "ADD_TIMELINE_EVENT",
      event: { id: generateId("tl"), mrNumber: patient!.mrNumber, stage: "OPD Consultation", datetime: new Date().toISOString(), department: appointment?.department ?? "OPD", staff: appointment?.doctorName ?? "Doctor", status: "Completed", details: diagnosis || "Consultation completed." },
    })
    toast({ title: "Consultation completed", description: `${patient!.name}'s visit has been marked done.`, variant: "success" })
    setCompleted(true)
  }

  function printPrescription() {
    if (!completed || status !== "Signed") return
    const currentPatient = patient
    if (!currentPatient) return
    const items = remotePrescription?.items ?? prescriptions
    const rows = items.map((item) => {
      const remoteItem = "medicineName" in item
      const medicineName = remoteItem ? item.medicineName : item.medicine
      const dosage = item.dosage ?? ""
      const frequency = item.frequency ?? ""
      const duration = remoteItem ? (item.durationDays ? `${item.durationDays} days` : "") : item.duration
      return `<tr><td>${medicineName}</td><td>${dosage}</td><td>${frequency}</td><td>${duration}</td><td>${item.instructions ?? ""}</td></tr>`
    }).join("")
    const tests = labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id).join(", ")
    const ultrasound = ultrasoundRecs.join(", ")
    const printWindow = window.open("", "_blank", "width=900,height=1000")
    if (!printWindow) return
    printWindow.document.write(`<html><head><title>Prescription - ${currentPatient.name}</title><style>body{font:14px Arial;color:#17212b;margin:42px}header{text-align:center;border-bottom:2px solid #1d6b63;padding-bottom:18px}h1{margin:0;color:#1d6b63}h2{font-size:16px;border-bottom:1px solid #ccd6d5;padding-bottom:6px;margin-top:26px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #dbe3e2;padding:9px 6px;vertical-align:top}footer{margin-top:45px;border-top:1px solid #ccd6d5;padding-top:12px;font-size:12px}</style></head><body><header><h1>Khalida Medicare Hospital</h1><div>Compassionate Care, Modern Medicine</div><div>12-B Gulberg III, Lahore | +92 42 3587 4210</div></header><h2>Patient</h2><p><b>${currentPatient.name}</b> | ${currentPatient.age} yrs | ${currentPatient.gender} | Patient ID: ${currentPatient.mrNumber}<br>Consultation date: ${formatDate(new Date().toISOString())}</p><h2>Clinical Summary</h2><p><b>Chief complaint:</b> ${chiefComplaint || "-"}<br><b>Diagnosis:</b> ${diagnosis || "-"}</p><h2>Medicines</h2><table><thead><tr><th>Name</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${rows}</tbody></table>${tests ? `<h2>Suggested Lab Tests</h2><p>${tests}</p>` : ""}${ultrasound ? `<h2>Suggested Ultrasound</h2><p>${ultrasound}</p>` : ""}<footer><p><b>Doctor:</b> ${appointment?.doctorName ?? "Assigned doctor"}</p><p><b>Signature:</b> Electronically signed</p><p><b>Signed on:</b> ${remotePrescription?.signedAt ? new Date(remotePrescription.signedAt).toLocaleString() : new Date().toLocaleString()}</p><p>For follow-up and appointments, please contact the hospital reception desk.</p></footer><script>window.onload=()=>window.print()</script></body></html>`)
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
              {patient.lastVisit ? `Last visit on ${formatDate(patient.lastVisit)}.` : "No previous visits recorded."} Blood group {patient.bloodGroup}. {patient.notes ?? ""}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vitals */}
      <Card>
        <CardHeader><CardTitle>Vitals</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([["bp", "BP (mmHg)"], ["temperature", "Temp (°F)"], ["pulse", "Pulse (bpm)"], ["weight", "Weight (kg)"], ["spo2", "SpO2 (%)"]] as [keyof VitalSigns, string][]).map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`v-${key}`}>{label}</Label>
              <Input id={`v-${key}`} disabled={locked} value={vitals[key]} onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))} className="cp-tabular" />
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
        <Button size="sm" onClick={completeConsultation}><CheckCircle2 className="h-4 w-4" /> Complete Consultation</Button>
      </div>
    </div>
  )
}
