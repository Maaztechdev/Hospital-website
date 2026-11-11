import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Plus, Trash2, Lock, Printer, Save, PenLine, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatBloodGroup, generateId, formatDate, getHospitalDateKey } from "@/dashboard/lib/format"
import type { Appointment, Consultation, Patient, PrescriptionItem, VitalSigns } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { NotPermitted } from "@/dashboard/components/Layout"
import { cn } from "@/lib/utils"
import { api, apiAssetUrl, getAccessToken, toPatient, toAppointment, type ApiConsultation, type ApiError, type ApiLabTest, type ApiMedicine, type ApiPatientClinicalSummary, type ApiPrescription, type ApiUltrasoundTemplate } from "@/lib/api"
import { useHospitalProfile } from "@/lib/hospitalProfile"
import QRCode from "qrcode"
import { getTemperatureRange, getCriticalVitals, VITAL_RANGES, VITAL_WARNINGS, type TemperatureUnit } from "../../../../../careplus-backend/src/common/validation/vitals"
import { describeFrequency, getMedicationAllergyMatches, hasDuplicateMedicine, normalizeMedicineName, DOSE_UNITS, DURATION_UNITS, FREQUENCY_OPTIONS, ROUTE_OPTIONS } from "../../../../../careplus-backend/src/common/validation/prescription"

const EMPTY_VITALS: VitalSigns = {
  bp: "",
  systolic: "",
  diastolic: "",
  temperature: "",
  temperatureUnit: "F",
  pulse: "",
  weight: "",
  spo2: "",
  respiratoryRate: "",
  heightCm: "",
}

const ultrasoundTypes = ["Abdomen", "Pelvis", "Obstetric", "KUB"]

function validateVitals(vitals: VitalSigns): Partial<Record<keyof VitalSigns, string>> {
  const errors: Partial<Record<keyof VitalSigns, string>> = {}
  const inRange = (key: keyof VitalSigns, label: string, range: { min: number; max: number }, integer = false) => {
    const value = vitals[key]
    if (!value) return
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue < range.min || numericValue > range.max || (integer && !Number.isInteger(numericValue))) {
      const suffix = key === "temperature" ? ` °${vitals.temperatureUnit ?? "F"}` : key === "weight" ? " kg" : key === "heightCm" ? " cm" : ""
      errors[key] = `${label} must be between ${range.min} and ${range.max}${suffix}.`
    }
  }
  const hasSystolic = Boolean(vitals.systolic)
  const hasDiastolic = Boolean(vitals.diastolic)
  if (hasSystolic !== hasDiastolic) errors.diastolic = "Enter both systolic and diastolic values."
  inRange("systolic", "Systolic", VITAL_RANGES.systolic, true)
  inRange("diastolic", "Diastolic", VITAL_RANGES.diastolic, true)
  if (hasSystolic && hasDiastolic && Number(vitals.systolic) <= Number(vitals.diastolic)) {
    errors.systolic = "Systolic pressure must be greater than diastolic pressure."
  }
  inRange("pulse", "Pulse", VITAL_RANGES.pulse, true)
  inRange("temperature", "Temperature", getTemperatureRange(vitals.temperatureUnit || "F"))
  inRange("respiratoryRate", "Respiratory rate", VITAL_RANGES.respiratoryRate, true)
  inRange("spo2", "SpO2", VITAL_RANGES.oxygenSaturation, true)
  inRange("weight", "Weight", VITAL_RANGES.weightKg)
  inRange("heightCm", "Height", VITAL_RANGES.heightCm)
  return errors
}

export default function DoctorConsultation() {
  const { appointmentId: routeAppointmentId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { patients, appointments, consultations, dispatch, currentUser, dataLoading } = useDashboard()
  const hospitalProfile = useHospitalProfile()

  const mrNumber = params.get("mr") ?? ""
  const [activeAppointmentId, setActiveAppointmentId] = React.useState(routeAppointmentId === "new" ? null : routeAppointmentId ?? null)
  const [retryKey, setRetryKey] = React.useState(0)
  const [fetchedPatient, setFetchedPatient] = React.useState<Patient | null>(null)
  const [fetchedAppointment, setFetchedAppointment] = React.useState<Appointment | null>(null)

  const appointment = appointments.find((a) => a.id === activeAppointmentId) ?? fetchedAppointment
  const patient = patients.find((p) => p.mrNumber === mrNumber) ?? patients.find((p) => p.mrNumber === appointment?.mrNumber) ?? fetchedPatient
  const [patientLoading, setPatientLoading] = React.useState(Boolean(activeAppointmentId || mrNumber) && !patient)

  React.useEffect(() => {
    if (patient) {
      setPatientLoading(false)
      return
    }
    let active = true
    setPatientLoading(true)

    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
    const resolvePatient = (idOrMr: string) => {
      if (isUuid(idOrMr)) {
        return api.getPatient(idOrMr)
      }
      return api.listPatients(idOrMr).then((list) => {
        const found = list.find((p) => p.mrNumber.toLowerCase() === idOrMr.toLowerCase()) ?? list[0]
        if (!found) throw new Error("Patient not found")
        return found
      })
    }

    const fetchPromises: Promise<unknown>[] = []

    const targetMr = mrNumber || appointment?.mrNumber
    if (targetMr) {
      fetchPromises.push(
        resolvePatient(targetMr)
          .then((p) => {
            if (!active) return
            setFetchedPatient(toPatient(p))
            setPatientLoading(false)
          })
          .catch(() => {})
      )
    }

    if (activeAppointmentId) {
      fetchPromises.push(
        api.getAppointment(activeAppointmentId)
          .then((appt) => {
            if (!active) return
            setFetchedAppointment(toAppointment(appt))
            if (appt.patient && !patient) {
              setFetchedPatient(toPatient(appt.patient))
            }
            const pId = (appt as { patientId?: string }).patientId || appt.patient?.mrNumber
            if (pId) {
              return resolvePatient(pId).then((p) => {
                if (active) {
                  setFetchedPatient(toPatient(p))
                  setPatientLoading(false)
                }
              })
            }
          })
          .catch(() => {})
      )
    }

    Promise.all(fetchPromises).finally(() => {
      if (active) setPatientLoading(false)
    })

    return () => { active = false }
  }, [activeAppointmentId, mrNumber, patient, appointment?.mrNumber, retryKey])
  const existing = consultations.find((c) => c.appointmentId === activeAppointmentId)
  const [remoteConsultation, setRemoteConsultation] = React.useState<ApiConsultation | null>(null)
  const [remotePrescription, setRemotePrescription] = React.useState<ApiPrescription | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [formLoaded, setFormLoaded] = React.useState(false)
  const [requestError, setRequestError] = React.useState<string | null>(null)
  const [concurrencyError, setConcurrencyError] = React.useState<string | null>(null)
  const prescriptionLoadId = React.useRef<string | null>(null)

  const [vitals, setVitals] = React.useState<VitalSigns>(existing?.vitals ?? EMPTY_VITALS)
  const [chiefComplaint, setChiefComplaint] = React.useState(existing?.chiefComplaint ?? "")
  const [clinicalNotes, setClinicalNotes] = React.useState(existing?.clinicalNotes ?? "")
  const [diagnosis, setDiagnosis] = React.useState(existing?.diagnosis ?? "")
  const [findings, setFindings] = React.useState("")
  const [refillNumber, setRefillNumber] = React.useState(0)
  const [doctorProfile, setDoctorProfile] = React.useState<{ qualification?: string | null; specialization?: string | null; pmdcRegistrationNo?: string | null; phcRegistrationNo?: string | null; registrationNumber?: string | null; signatureUrl?: string | null; stampUrl?: string | null } | null>(null)
  const [prescriptions, setPrescriptions] = React.useState<PrescriptionItem[]>(existing?.prescriptions ?? [])
  const [labRecs, setLabRecs] = React.useState<string[]>(existing?.labRecommendations ?? [])
  const [followUp, setFollowUp] = React.useState(existing?.followUpDate ?? "")
  const [followUpInstructions, setFollowUpInstructions] = React.useState(existing?.followUpInstructions ?? "")
  const [referral, setReferral] = React.useState(existing?.referral ?? "")
  const [status, setStatus] = React.useState<Consultation["status"]>(existing?.status ?? "Draft")
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [clinicalSummary, setClinicalSummary] = React.useState<ApiPatientClinicalSummary | null>(null)
  const [clinicalSummaryError, setClinicalSummaryError] = React.useState("")
  const [clinicalSummaryRetry, setClinicalSummaryRetry] = React.useState(0)
  const [historyEditing, setHistoryEditing] = React.useState(false)
  const [allergyDraft, setAllergyDraft] = React.useState("")
  const [chronicConditionsDraft, setChronicConditionsDraft] = React.useState("")
  const [savingHistory, setSavingHistory] = React.useState(false)
  const [autocompleteIdx, setAutocompleteIdx] = React.useState<number | null>(null)
  const [completed, setCompleted] = React.useState(false)
  const [medicineSearch, setMedicineSearch] = React.useState("")
  const [medicines, setMedicines] = React.useState<ApiMedicine[]>([])
  const [allergyOverrides, setAllergyOverrides] = React.useState<string[]>([])
  const [duplicateMedicineError, setDuplicateMedicineError] = React.useState("")
  const [prescriptionErrors, setPrescriptionErrors] = React.useState<Record<string, string>>({})
  const [labTests, setLabTests] = React.useState<ApiLabTest[]>([])
  const [ultrasoundTemplates, setUltrasoundTemplates] = React.useState<ApiUltrasoundTemplate[]>([])
  const [ultrasoundRecs, setUltrasoundRecs] = React.useState<string[]>([])
  const [consultationHistory, setConsultationHistory] = React.useState<ApiConsultation[]>([])
  const [labSearch, setLabSearch] = React.useState("")
  const [ultrasoundSearch, setUltrasoundSearch] = React.useState("")
  const [followUpAppointment, setFollowUpAppointment] = React.useState(false)
  const [completionErrors, setCompletionErrors] = React.useState<{ chiefComplaint?: string; diagnosis?: string }>({})
  const [draftSavedAt, setDraftSavedAt] = React.useState<Date | null>(null)
  const [isDirty, setIsDirty] = React.useState(false)
  const [addendumText, setAddendumText] = React.useState("")
  const [addendumOpen, setAddendumOpen] = React.useState(false)
  const [savingAddendum, setSavingAddendum] = React.useState(false)
  const [criticalConfirmed, setCriticalConfirmed] = React.useState(false)
  const criticalList = React.useMemo(() => {
    const numeric = (val?: string) => val ? Number(val) : undefined
    return getCriticalVitals({
      bp_systolic: numeric(vitals.systolic),
      bp_diastolic: numeric(vitals.diastolic),
      temperature: numeric(vitals.temperature),
      temperature_unit: vitals.temperature ? vitals.temperatureUnit : undefined,
      pulse: numeric(vitals.pulse),
      weight: numeric(vitals.weight),
      oxygen_saturation: numeric(vitals.spo2),
      respiratory_rate: numeric(vitals.respiratoryRate),
      height_cm: numeric(vitals.heightCm),
    }, patient?.age)
  }, [vitals, patient?.age])
  const savedSnapshotRef = React.useRef("")
  const isDirtyRef = React.useRef(false)
  const saveDraftRef = React.useRef<((automatic?: boolean) => Promise<void>) | null>(null)

  React.useEffect(() => {
    setRequestError(null)
    setLoading(true)
    setFormLoaded(false)
    prescriptionLoadId.current = null
    if (routeAppointmentId === "new" && !activeAppointmentId) {
      if (!patient?.id && dataLoading) return
      if (!patient?.id) { setRequestError("The selected patient could not be found."); setLoading(false); return }
      api.startPatientConsultation(patient.id)
        .then((item) => { setActiveAppointmentId(item.appointmentId); setRemoteConsultation(item) })
        .catch((error: ApiError) => setRequestError(error.message || "Unable to start consultation"))
        .finally(() => setLoading(false))
      return
    }
    if (!activeAppointmentId) {
      setRemoteConsultation(null)
      setLoading(false)
      setFormLoaded(true)
      return
    }
    api.listConsultations(activeAppointmentId)
      .then((items) => {
        setRemoteConsultation(items[0] ?? null)
        if (!items[0]) setFormLoaded(true)
      })
      .catch((error: ApiError) => setRequestError(error.message || "Unable to load consultation"))
      .finally(() => setLoading(false))
  }, [activeAppointmentId, dataLoading, patient?.id, routeAppointmentId, retryKey])

  React.useEffect(() => {
    void Promise.all([api.listLabTests(), api.listMedicines(), api.listUltrasoundTemplates()])
      .then(([tests, medicineList, ultrasoundList]) => {
        setLabTests(tests)
        setMedicines(medicineList)
        setUltrasoundTemplates(ultrasoundList)
      })
      .catch((error: ApiError) => setRequestError(error.message || "Unable to load clinical catalogs"))
  }, [])

  React.useEffect(() => {
    if (currentUser?.role === "doctor") {
      void api.getMyStaffProfile().then((result) => setDoctorProfile(result.profile)).catch((cause) => setRequestError(cause instanceof Error ? cause.message : "Unable to load doctor profile"))
    }
  }, [currentUser?.role])

  React.useEffect(() => {
    if (!patient?.id) return
    let active = true
    setClinicalSummaryError("")
    api.getPatientClinicalSummary(patient.id)
      .then((summary) => {
        if (!active) return
        setClinicalSummary(summary)
        setAllergyDraft(summary.allergies.join(", "))
        setChronicConditionsDraft(summary.chronicConditions.join(", "))
      })
      .catch((cause: unknown) => {
        if (active) setClinicalSummaryError(cause instanceof Error ? cause.message : "Clinical history could not be loaded.")
      })
    return () => { active = false }
  }, [patient?.id, clinicalSummaryRetry])

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
          doseAmount: item.doseAmount == null ? item.dosage?.match(/^[\d.]+/)?.[0] ?? "" : String(item.doseAmount),
          doseUnit: item.doseUnit ?? item.dosage?.replace(/^[\d.]+\s*/, "") ?? "tablet",
          legacyDosage: item.doseAmount == null ? item.dosage ?? "" : undefined,
          route: item.route ?? "Oral",
          frequencyCode: item.frequencyCode ?? "OD",
          legacyFrequency: item.frequencyCode ? undefined : item.frequency ?? "",
          durationValue: String(item.durationValue ?? item.durationDays),
          durationUnit: item.durationUnit === "weeks" || item.durationUnit === "months" ? item.durationUnit : "days",
          legacyDuration: item.durationValue == null ? `${item.durationDays} days` : undefined,
          instructions: item.instructions ?? "",
        })))
        setRefillNumber(prescription.refillNumber ?? 0)
      }
      setFormLoaded(true)
      setDraftSavedAt(remoteConsultation.updatedAt ? new Date(remoteConsultation.updatedAt) : null)
    }).catch((cause) => setRequestError(cause instanceof Error ? cause.message : "Unable to load prescriptions"))
  }, [remoteConsultation])

  React.useEffect(() => {
    if (!patient?.id) return
    const loadHistory = () => {
      api.listConsultations(undefined, patient.id)
        .then(setConsultationHistory)
        .catch((cause) => setRequestError(cause instanceof Error ? cause.message : "Unable to load patient history"))
    }
    loadHistory()
    window.addEventListener("careplus:data-invalidated", loadHistory)
    return () => window.removeEventListener("careplus:data-invalidated", loadHistory)
  }, [patient?.id])

  React.useEffect(() => {
    if (!remoteConsultation) return
    setVitals({
      ...EMPTY_VITALS,
      systolic: remoteConsultation.bpSystolic?.toString() ?? "",
      diastolic: remoteConsultation.bpDiastolic?.toString() ?? "",
      temperature: remoteConsultation.temperature?.toString() ?? "",
      temperatureUnit: remoteConsultation.temperatureUnit ?? "F",
      pulse: remoteConsultation.pulse?.toString() ?? "",
      weight: remoteConsultation.weight?.toString() ?? "",
      spo2: remoteConsultation.oxygenSaturation?.toString() ?? "",
      respiratoryRate: remoteConsultation.respiratoryRate?.toString() ?? "",
      heightCm: remoteConsultation.heightCm?.toString() ?? "",
    })
    setChiefComplaint(remoteConsultation.chiefComplaint ?? "")
    setClinicalNotes(remoteConsultation.clinicalNotes ?? "")
    setDiagnosis(remoteConsultation.diagnosis ?? "")
    setFindings(remoteConsultation.findings ?? "")
    setFollowUp(remoteConsultation.followUpDate?.slice(0, 10) ?? "")
    setFollowUpInstructions(remoteConsultation.followUpInstructions ?? "")
    setReferral(remoteConsultation.referral ?? "")
    setStatus(remoteConsultation.prescriptionStatus === "DRAFT" ? "Draft" : "Signed")
    setCompleted(remoteConsultation.prescriptionStatus === "COMPLETED")
    if (remoteConsultation.prescriptionStatus === "COMPLETED") setCompleted(true)
  }, [remoteConsultation])

  const locked = status === "Signed" || (remoteConsultation !== null && remoteConsultation.prescriptionStatus !== "DRAFT")
  const draftSnapshot = JSON.stringify({
    vitals, chiefComplaint, clinicalNotes, diagnosis, findings, prescriptions,
    labRecs, ultrasoundRecs, followUp, followUpInstructions, referral, refillNumber, followUpAppointment,
  })

  React.useEffect(() => {
    if (!formLoaded) return
    if (!savedSnapshotRef.current) {
      savedSnapshotRef.current = draftSnapshot
      return
    }
    const dirty = savedSnapshotRef.current !== draftSnapshot
    isDirtyRef.current = dirty
    setIsDirty(dirty)
  }, [draftSnapshot, formLoaded])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (isDirtyRef.current) void saveDraftRef.current?.(true)
    }, 30_000)
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("beforeunload", warnBeforeUnload)
    }
  }, [])

  async function saveDraft(automatic = false) {
    if (!activeAppointmentId || !patient?.id || locked) return
    const error = Object.values(validateVitals(vitals))[0]
    if (error) {
      if (!automatic) toast({ title: "Check vital signs", description: error, variant: "error" })
      return
    }
    if (criticalList.length > 0 && !criticalConfirmed) {
      if (!automatic) toast({ title: "Confirm critical vital values", description: `Critical vital values detected (${criticalList.map((c) => `${c.label} ${c.value}${c.unit}`).join(", ")}). Please confirm before saving.`, variant: "error" })
      return
    }
    const savedSnapshot = draftSnapshot
    try {
      const saved = remoteConsultation ? await api.updateConsultation(remoteConsultation.id, consultationPayload()) : await api.createConsultation(consultationPayload())
      setRemoteConsultation(saved)
      await createLinkedOrders(saved.id)
      setStatus("Draft")
      savedSnapshotRef.current = savedSnapshot
      isDirtyRef.current = false
      setIsDirty(false)
      setDraftSavedAt(new Date())
      if (!automatic) toast({ title: "Draft saved", variant: "success" })
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.status === 409 || apiError.message?.toLowerCase().includes("changed by another user")) {
        const msg = "this record was changed by another user, reload"
        setConcurrencyError(msg)
        toast({ title: "Conflict Detected", description: msg, variant: "error" })
      } else if (!automatic) {
        toast({ title: "Draft save failed", description: apiError.message, variant: "error" })
      } else {
        console.error("Consultation autosave failed", error)
      }
    }
  }
  saveDraftRef.current = saveDraft

  if (!requestError && (loading || patientLoading || (!formLoaded && Boolean(activeAppointmentId)) || (dataLoading && !patient))) {
    return <div role="status" aria-label="Loading consultation" className="flex flex-col gap-4">
      <div className="h-8 w-64 animate-pulse rounded bg-[var(--cp-border)]" />
      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-3">
        <div className="h-5 animate-pulse rounded bg-[var(--cp-border)]" /><div className="h-5 animate-pulse rounded bg-[var(--cp-border)]" /><div className="h-5 animate-pulse rounded bg-[var(--cp-border)]" />
      </CardContent></Card>
      {[0, 1, 2].map((section) => <Card key={section}><CardHeader><div className="h-5 w-40 animate-pulse rounded bg-[var(--cp-border)]" /></CardHeader><CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-9 animate-pulse rounded bg-[var(--cp-border)]" />)}</CardContent></Card>)}
    </div>
  }

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

  if (!patient && !activeAppointmentId && (routeAppointmentId === "new" || !routeAppointmentId) && !mrNumber) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardPageHeader title="Start Consultation" />
        <Card><CardContent className="p-6 text-sm text-[var(--cp-ink-soft)]">Select a patient from the Patients list or Doctor dashboard to begin a consultation.</CardContent></Card>
      </div>
    )
  }
  if (!patient) return <Card><CardContent className="flex flex-col gap-4 p-6"><p role="alert" className="text-sm text-[var(--cp-critical)]">Patient details could not be loaded for this appointment.</p><div className="flex gap-2"><Button onClick={() => setRetryKey((key) => key + 1)}>Retry</Button><Button variant="outline" onClick={() => navigate("/dashboard")}>Go Back to Dashboard</Button></div></CardContent></Card>

  const patientAllergies = clinicalSummary?.allergies ?? patient.allergies
  const vitalErrors = validateVitals(vitals)
  const bmi = vitals.weight && vitals.heightCm
    ? Number(vitals.weight) / (Number(vitals.heightCm) / 100) ** 2
    : null
  const temperatureValue = Number(vitals.temperature)
  const feverThreshold = vitals.temperatureUnit === "F" ? VITAL_WARNINGS.feverF : VITAL_WARNINGS.feverC

  function addPrescriptionRow() {
    setPrescriptions((p) => [...p, { id: generateId("rx"), medicine: "", doseAmount: "", doseUnit: "tablet", route: "Oral", frequencyCode: "OD", durationValue: "", durationUnit: "days", instructions: "" }])
  }
  function updateRow(id: string, patch: Partial<PrescriptionItem>) {
    setPrescriptionErrors((current) => {
      const { [id]: _removed, ...remaining } = current
      return remaining
    })
    setPrescriptions((p) => {
      const updated = p.map((r) => (r.id === id ? { ...r, ...patch } : r))
      setDuplicateMedicineError(hasDuplicateMedicine(updated.map((row) => ({ medicineId: row.medicineId, medicineName: row.medicine.trim() }))) ? "A medicine can only be added once to a prescription." : "")
      return updated
    })
  }
  function confirmMedicineAllergy(rowId: string, medicineName: string) {
    const matches = getMedicationAllergyMatches(patientAllergies, medicineName)
    if (!matches.length) return true
    if (!window.confirm(`Patient is allergic to ${matches.join(", ")}. Prescribe anyway?`)) {
      updateRow(rowId, { medicine: "", medicineId: undefined })
      return false
    }
    setAllergyOverrides((current) => [...new Set([...current, medicineName])])
    return true
  }
  function removeRow(id: string) {
    setPrescriptionErrors((current) => {
      const { [id]: _removed, ...remaining } = current
      return remaining
    })
    setPrescriptions((p) => {
      const updated = p.filter((r) => r.id !== id)
      setDuplicateMedicineError(hasDuplicateMedicine(updated.map((row) => ({ medicineId: row.medicineId, medicineName: row.medicine.trim() }))) ? "A medicine can only be added once to a prescription." : "")
      return updated
    })
  }
  async function saveClinicalHistory() {
    if (!patient?.id) {
      setClinicalSummaryError("Patient details are unavailable. Reload the consultation and try again.")
      return
    }
    setSavingHistory(true)
    setClinicalSummaryError("")
    try {
      const updated = await api.updatePatientClinicalHistory(patient.id, {
        allergies: allergyDraft.split(",").map((item) => item.trim()).filter(Boolean),
        chronicConditions: chronicConditionsDraft.split(",").map((item) => item.trim()).filter(Boolean),
      })
      setClinicalSummary((current) => current ? { ...current, ...updated } : current)
      setHistoryEditing(false)
    } catch (cause) {
      setClinicalSummaryError(cause instanceof Error ? cause.message : "Clinical history could not be saved.")
    } finally {
      setSavingHistory(false)
    }
  }
  function repeatPreviousPrescription() {
    const medicinesToRepeat = clinicalSummary?.lastPrescription?.medicines ?? []
    if (!medicinesToRepeat.length) return
    setPrescriptions(medicinesToRepeat.map((medicine) => ({
      id: generateId("rx"),
      medicine: medicine.name,
      medicineId: medicine.medicineId ?? undefined,
      doseAmount: medicine.doseAmount === null ? "" : String(medicine.doseAmount),
      doseUnit: medicine.doseUnit,
      route: medicine.route || "Oral",
      frequencyCode: medicine.frequencyCode || "OD",
      durationValue: String(medicine.durationValue),
      durationUnit: medicine.durationUnit === "weeks" || medicine.durationUnit === "months" ? medicine.durationUnit : "days",
      instructions: "",
    })))
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
      followUpDate: followUp || undefined, followUpInstructions: followUpInstructions || undefined, referral: referral || undefined,
      status: finalStatus,
      signedAt: finalStatus === "Signed" ? new Date().toISOString() : existing?.signedAt,
    }
  }

  function consultationPayload() {
    const numeric = (value?: string) => value ? Number(value) : undefined
    return {
      appointmentId: activeAppointmentId ?? "",
      chiefComplaint: chiefComplaint || undefined,
      vitals: {
        bp_systolic: numeric(vitals.systolic),
        bp_diastolic: numeric(vitals.diastolic),
        temperature: numeric(vitals.temperature),
        temperature_unit: vitals.temperature ? vitals.temperatureUnit : undefined,
        pulse: numeric(vitals.pulse),
        weight: numeric(vitals.weight),
        oxygen_saturation: numeric(vitals.spo2),
        respiratory_rate: numeric(vitals.respiratoryRate),
        height_cm: numeric(vitals.heightCm),
        critical_confirmed: criticalConfirmed,
      },
      diagnosis: diagnosis || undefined,
      findings: findings || undefined,
      clinicalNotes: clinicalNotes || undefined,
      followUpDate: followUp || undefined,
      followUpInstructions: followUpInstructions || undefined,
      referral: referral || undefined,
      expectedUpdatedAt: remoteConsultation?.updatedAt || undefined,
    }
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

  async function signPrescription() {
    const vitalError = Object.values(validateVitals(vitals))[0]
    if (vitalError) {
      toast({ title: "Check vital signs", description: vitalError, variant: "error" })
      return
    }
    try {
      if (hasDuplicateMedicine(prescriptions.map((item) => ({ medicineId: item.medicineId, medicineName: item.medicine.trim() })))) {
        toast({ title: "Duplicate medicine", description: "A medicine can only be added once to a prescription.", variant: "error" })
        return
      }
      const unselectedMedicineIndex = prescriptions.findIndex((item) => !item.medicine.trim() || !item.medicineId)
      if (unselectedMedicineIndex !== -1) {
        const item = prescriptions[unselectedMedicineIndex]
        setPrescriptionErrors({ [item.id]: `Medicine ${unselectedMedicineIndex + 1}: medicine is missing from the catalog.` })
        return
      }
      setPrescriptionErrors({})
      if (prescriptions.length === 0 || prescriptions.some((item) => !item.medicine.trim() || !Number(item.doseAmount) || !item.doseUnit || !item.frequencyCode || !Number(item.durationValue) || !item.durationUnit)) {
        toast({ title: "Prescription details required", description: "Add a medicine, valid dose, frequency, and duration before signing.", variant: "error" })
        return
      }
      const confirmedOverrides = [...allergyOverrides]
      for (const item of prescriptions) {
        const matches = getMedicationAllergyMatches(patientAllergies, item.medicine)
        if (!matches.length || confirmedOverrides.some((name) => normalizeMedicineName(name) === normalizeMedicineName(item.medicine))) continue
        if (!window.confirm(`Patient is allergic to ${matches.join(", ")}. Prescribe anyway?`)) return
        confirmedOverrides.push(item.medicine)
      }
      setAllergyOverrides(confirmedOverrides)
      const consultation = remoteConsultation ? await api.updateConsultation(remoteConsultation.id, consultationPayload()) : await api.createConsultation(consultationPayload())
      setRemoteConsultation(consultation)
      await createLinkedOrders(consultation.id)
      const existingPrescription = remotePrescription ?? (await api.listPrescriptions()).find((item) => item.consultationId === consultation.id)
      const prescription = existingPrescription ?? await api.createPrescription({
        consultationId: consultation.id,
        padData: { visitNumber: appointment?.token?.toString(), visitDate: getHospitalDateKey(), visitTime: appointment?.time, relationship: "", patientAddress: patient!.address, patientContact: patient!.phone, patientAge: patient!.age, patientGender: patient!.gender.toUpperCase() as "MALE" | "FEMALE" | "OTHER", patientWeight: vitals.weight, vitals: { bp_systolic: vitals.systolic, bp_diastolic: vitals.diastolic, pulse: vitals.pulse, temperature: vitals.temperature, temperature_unit: vitals.temperatureUnit, respiratory_rate: vitals.respiratoryRate, weight: vitals.weight, oxygen_saturation: vitals.spo2, height_cm: vitals.heightCm }, allergies: patientAllergies.join(", "), presentingComplaints: chiefComplaint, history: patient!.notes, findings, investigations: [...labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id), ...ultrasoundRecs].join(", "), refillNumber },
        items: prescriptions.map((item) => ({ medicineId: item.medicineId, isCatalogItem: Boolean(item.medicineId), medicineName: item.medicine.trim(), doseAmount: Number(item.doseAmount), doseUnit: item.doseUnit!, route: item.route, frequencyCode: item.frequencyCode!, durationValue: Number(item.durationValue), durationUnit: item.durationUnit!, instructions: item.instructions?.trim() || undefined })),
        allergyOverrides: confirmedOverrides,
      })
      const signedPrescription = prescription.status === "DRAFT" ? await api.signPrescription(prescription.id, prescription.updatedAt) : prescription
      setRemotePrescription(signedPrescription)
      const saved = consultation.prescriptionStatus === "DRAFT" ? await api.signConsultation(consultation.id) : consultation
      setRemoteConsultation(saved)
      setStatus("Signed")
      toast({ title: "Prescription signed", description: "The signed prescription is now available to Pharmacy.", variant: "success" })
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.status === 409 || apiError.message?.toLowerCase().includes("changed by another user")) {
        const msg = "this record was changed by another user, reload"
        setConcurrencyError(msg)
        toast({ title: "Conflict Detected", description: msg, variant: "error" })
      } else {
        toast({ title: "Sign failed", description: apiError.message, variant: "error" })
      }
    }
  }

  async function completeConsultation() {
    if (status !== "Signed") { toast({ title: "Sign the prescription first", description: "The consultation can be completed after signing.", variant: "error" }); return }
    if (!remoteConsultation) { toast({ title: "Save the consultation first", description: "The consultation record is not available yet.", variant: "error" }); return }
    const errors = {
      ...(chiefComplaint.trim() ? {} : { chiefComplaint: "Chief complaint is required before completing." }),
      ...(diagnosis.trim() ? {} : { diagnosis: "Diagnosis is required before completing." }),
    }
    setCompletionErrors(errors)
    if (Object.keys(errors).length) return
    const labNames = labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id)
    const summary = [
      `Diagnosis: ${diagnosis}`,
      `Medicines: ${prescriptions.length}`,
      `Lab tests: ${labNames.length ? labNames.join(", ") : "None"}`,
      `Ultrasound: ${ultrasoundRecs.length ? ultrasoundRecs.join(", ") : "None"}`,
      `Follow-up: ${followUp || "Not set"}`,
    ].join("\n")
    if (!window.confirm(`Complete this consultation?\n\n${summary}`)) return
    try {
      const saved = await api.completeConsultation(remoteConsultation.id)
      setRemoteConsultation(saved)
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
    isDirtyRef.current = false
    setIsDirty(false)
    if (followUpAppointment && followUp) {
      try {
        const doctor = (await api.listDoctors()).find((item) => item.id === appointment?.doctorId)
        if (!doctor) throw new Error("The assigned doctor is unavailable for follow-up scheduling.")
        const slots = await api.getAvailableSlots(doctor.id, followUp)
        const timeSlot = slots.availableSlots[0]
        if (!timeSlot) throw new Error("No appointment slots are available on the selected follow-up date.")
        await api.createAppointment({
          patientId: patient!.id,
          doctorId: doctor.id,
          departmentId: doctor.department?.id,
          appointmentDate: followUp,
          timeSlot,
          appointmentType: "FOLLOW_UP",
          source: "WALK_IN",
          reason: `Follow-up after consultation: ${diagnosis}`,
        })
        toast({ title: "Follow-up appointment created", description: `${followUp} at ${timeSlot}.`, variant: "success" })
      } catch (error) {
        toast({ title: "Consultation completed; follow-up not scheduled", description: (error as ApiError).message, variant: "error" })
      }
    }
  }

  async function saveAddendum() {
    if (!remoteConsultation || !addendumText.trim()) return
    setSavingAddendum(true)
    try {
      const addendum = await api.addConsultationAddendum(remoteConsultation.id, addendumText.trim())
      setRemoteConsultation((current) => current ? { ...current, addenda: [...(current.addenda ?? []), addendum] } : current)
      setAddendumText("")
      setAddendumOpen(false)
      toast({ title: "Addendum recorded", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to save addendum", description: (error as ApiError).message, variant: "error" })
    } finally {
      setSavingAddendum(false)
    }
  }

  async function printPrescription() {
    if (!completed || status !== "Signed") return
    const currentPatient = patient
    if (!currentPatient) return

    // Ensure remote prescription is fully loaded before rendering print
    let activePrescription = remotePrescription
    if (!activePrescription && remoteConsultation) {
      try {
        const items = await api.listPrescriptions()
        const found = items.find((item) => item.consultationId === remoteConsultation.id) ?? null
        if (found) {
          activePrescription = found
          setRemotePrescription(found)
        }
      } catch { }
    }

    const printWindow = window.open("", "_blank", "width=900,height=1000")
    if (!printWindow) return
    const prescription = activePrescription
    const refNo = prescription?.id ?? remoteConsultation?.id ?? activeAppointmentId ?? "PRESCRIPTION"
    const qrCode = await QRCode.toDataURL(refNo, { width: 150, margin: 1 })
    const esc = (value: unknown) => String(value ?? "-").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character)
    const value = (text: unknown) => esc(text || "-")
    const items = activePrescription?.items ?? prescriptions
    const rows = items.map((item) => {
      const remoteItem = "medicineName" in item
      const medicineName = remoteItem ? item.medicineName : item.medicine
      const amount = item.doseAmount
      const unit = item.doseUnit
      const dosage = amount != null && unit ? `${amount} ${unit}` : remoteItem ? item.dosage : item.legacyDosage
      const frequencyCode = item.frequencyCode
      const frequency = frequencyCode
        ? `${frequencyCode} - ${describeFrequency(frequencyCode)}`
        : remoteItem ? item.frequency : item.legacyFrequency
      const duration = item.durationValue != null && item.durationUnit
        ? `${item.durationValue} ${item.durationUnit}`
        : remoteItem ? `${item.durationDays} days` : item.legacyDuration
      return `<tr><td><strong>${value(medicineName)}</strong></td><td>${value(dosage)}</td><td>${value(item.route)}</td><td>${value(frequency)}</td><td>${value(duration)}</td><td>${value(item.instructions)}</td></tr>`
    }).join("")
    const tests = labRecs.map((id) => labTests.find((test) => test.id === id)?.testName ?? id).join(", ")
    const ultrasound = ultrasoundRecs.join(", ")
    const signedAt = prescription?.signedAt ?? remoteConsultation?.signedAt ?? new Date().toISOString()
    const doctorName = currentUser?.name ?? appointment?.doctorName ?? "Doctor"
    const pmdcRegistrationNo = doctorProfile?.pmdcRegistrationNo ?? doctorProfile?.registrationNumber
    const doctorRegistrationNumbers = [
      pmdcRegistrationNo ? `PM&DC Reg No.: ${pmdcRegistrationNo}` : "",
      doctorProfile?.phcRegistrationNo ? `PHC Reg No.: ${doctorProfile.phcRegistrationNo}` : "",
    ].filter(Boolean).join(" | ")
    const allergySummary = currentPatient.allergies.length ? currentPatient.allergies.join(", ") : "No known allergies"
    const relationship = currentPatient.emergencyContact ? `S/o D/o W/o: ${currentPatient.emergencyContact}` : ""
    const patientGender = currentPatient.gender ? (currentPatient.gender.toUpperCase() === "MALE" ? "Male" : currentPatient.gender.toUpperCase() === "FEMALE" ? "Female" : currentPatient.gender.toUpperCase() === "OTHER" ? "Other" : currentPatient.gender) : "-"

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
      @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17212b;margin:0;font-size:10px;line-height:1.25}.sheet{max-width:190mm;margin:auto}.header{display:grid;grid-template-columns:1fr 1fr;gap:12px;border-bottom:2px solid #1d6b63;padding-bottom:7px}.hospital h1{font-size:21px;color:#1d6b63;margin:0 0 3px}.hospital p,.doctor p{margin:1px 0}.doctor{text-align:right}.doctor h2{font-size:15px;margin:0 0 3px;color:#1d6b63}.qr{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:4px}.qr img{width:50px;height:50px}.ref{font-size:9px;word-break:break-all}.patient-bar{margin:7px 0;padding:6px 8px;background:#e7f3f1;border:1px solid #acd3cd;border-radius:3px;display:grid;grid-template-columns:repeat(4,1fr);gap:3px 10px}.patient-bar strong{color:#0f554e}.columns{display:grid;grid-template-columns:34% 66%;gap:10px;margin-top:7px}.section{margin-bottom:8px}.section h3{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#1d6b63;border-bottom:1px solid #b9cfcc;padding-bottom:2px;margin:0 0 4px}.section p{margin:2px 0;white-space:pre-wrap}.vitals{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:2px 0}.vital{border:1px solid #d5e2e0;border-radius:2px;padding:2px 3px;font-size:8.5px;line-height:1.1;background:#fafcfb}.vital b{display:block;font-size:7.5px;color:#4c6b67;margin-bottom:1px}.rx-table{width:100%;border-collapse:collapse;table-layout:fixed}.rx-table th,.rx-table td{text-align:left;border-bottom:1px solid #d5e2e0;padding:4px 3px;vertical-align:top;overflow-wrap:anywhere}.rx-table th{background:#f0f6f5;font-size:9px}.footer{border-top:1px solid #b9cfcc;margin-top:8px;padding-top:7px;display:grid;grid-template-columns:1fr 1fr;gap:10px;break-inside:avoid;page-break-inside:avoid}.stamp-box{height:55px;width:130px;border:1px dashed #91aaa6;display:flex;align-items:center;justify-content:center;color:#718784;font-size:9px}.signatures{display:flex;justify-content:flex-end;gap:12px;text-align:center}.signature{min-width:95px}.profile-image{height:45px;max-width:115px;object-fit:contain;display:block;margin:auto}.signature-line{height:45px;border-bottom:1px solid #7f9995}.bottom{grid-column:1/-1;border-top:1px solid #d5e2e0;margin-top:4px;padding-top:5px;display:flex;justify-content:space-between;gap:8px;font-size:9px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body><main class="sheet">
      <header class="header"><div class="hospital">${hospitalProfile.logoUrl ? `<img src="${esc(apiAssetUrl(hospitalProfile.logoUrl))}" alt="" style="max-height:42px;max-width:150px;object-fit:contain">` : ""}<h1>${value(hospitalProfile.name)}</h1>${hospitalProfile.address ? `<p>${value(hospitalProfile.address)}</p>` : ""}${hospitalProfile.phone || hospitalProfile.email ? `<p>${value(hospitalProfile.phone)}${hospitalProfile.email ? ` | ${value(hospitalProfile.email)}` : ""}</p>` : ""}</div><div class="doctor"><h2>${value(doctorName)}</h2><p>${value(doctorProfile?.qualification)}</p><p>${value(doctorProfile?.specialization)}</p>${doctorRegistrationNumbers ? `<p>${value(doctorRegistrationNumbers)}</p>` : ""}<div class="qr"><div class="ref">Ref No.<br><strong>${value(refNo)}</strong></div><img src="${qrCode}" alt="Verification QR code"></div></div></header>
      <section class="patient-bar"><div><strong>Patient:</strong> ${value(currentPatient.name)}</div><div><strong>${value(relationship)}</strong></div><div><strong>Visit No.:</strong> ${value(appointment?.token)}</div><div><strong>Date:</strong> ${value(formatDate(appointment?.date ?? new Date().toISOString()))}</div><div><strong>Time:</strong> ${value(appointment?.time)}</div><div><strong>Address:</strong> ${value(currentPatient.address)}</div><div><strong>Contact:</strong> ${value(currentPatient.phone)}</div><div><strong>MR No.:</strong> ${value(currentPatient.mrNumber)}</div></section>
      <div class="columns"><aside><section class="section"><h3>Vitals</h3><div class="vitals"><div class="vital"><b>BP (mmHg)</b>${value(vitals.systolic && vitals.diastolic ? `${vitals.systolic}/${vitals.diastolic}` : "")}</div><div class="vital"><b>Pulse (bpm)</b>${value(vitals.pulse)}</div><div class="vital"><b>Temperature</b>${value(vitals.temperature ? `${vitals.temperature} °${vitals.temperatureUnit}` : "")}</div><div class="vital"><b>RR (/min)</b>${value(vitals.respiratoryRate)}</div><div class="vital"><b>Weight (kg)</b>${value(vitals.weight)}</div><div class="vital"><b>SpO2 (%)</b>${value(vitals.spo2)}</div><div class="vital"><b>Height (cm)</b>${value(vitals.heightCm)}</div><div class="vital"><b>BMI</b>${value(vitals.weight && vitals.heightCm ? (Number(vitals.weight) / (Number(vitals.heightCm) / 100) ** 2).toFixed(1) : "")}</div></div></section><section class="section"><h3>Allergies</h3><p>${value(allergySummary)}</p></section><section class="section"><h3>Presenting Complaints</h3><p>${value(chiefComplaint)}</p></section><section class="section"><h3>History</h3><p>${value(currentPatient.notes)}</p></section><section class="section"><h3>Findings</h3><p>${value(findings)}</p></section><section class="section"><h3>Investigations</h3><p>${value([tests, ultrasound].filter(Boolean).join(", "))}</p></section></aside><section><section class="section"><h3>Patient Assessment</h3><p><strong>Age:</strong> ${value(currentPatient.age)} &nbsp; <strong>Gender:</strong> ${value(patientGender)} &nbsp; <strong>Weight:</strong> ${value(vitals.weight)}</p></section><section class="section"><h3>Provisional / Diagnosis</h3><p>${value(diagnosis)}</p></section><section class="section"><h3>Rx</h3><table class="rx-table"><thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No medicines prescribed</td></tr>`}</tbody></table></section>${(followUp || followUpInstructions) ? `<section class="section"><h3>Follow-up</h3><p><strong>Next Visit:</strong> ${followUp ? value(formatDate(followUp)) : "As advised"}</p>${followUpInstructions ? `<p><strong>Instructions:</strong> ${value(followUpInstructions)}</p>` : ""}</section>` : ""}</section></div>
      <footer class="footer">${dispensingStamp ? `<div><p><strong>Dispensing Stamp</strong></p><div class="stamp-box">${value(dispensingStamp)}</div></div>` : ""}${signatureBlocks ? `<div class="signatures">${signatureBlocks}</div>` : ""}<div class="bottom"><span>${value(hospitalProfile.refillText || `Refills: ${refillNumber}`)} | Refill selected: ${refillNumber}</span><span>${value(hospitalProfile.phone)} | ${value(hospitalProfile.clinicDaysTimings)}</span><span>Signed: ${value(new Date(signedAt).toLocaleString())}</span></div></footer>
    </main></body></html>`)
    printWindow.document.close()
    triggerPrint()
  }

  const lastVisitRecord = consultationHistory.find((item) => item.id !== remoteConsultation?.id) ?? consultationHistory[0]
  const lastVitals = lastVisitRecord
    ? [
      lastVisitRecord.bpSystolic && lastVisitRecord.bpDiastolic ? `BP ${lastVisitRecord.bpSystolic}/${lastVisitRecord.bpDiastolic}` : "",
      lastVisitRecord.pulse ? `Pulse ${lastVisitRecord.pulse}` : "",
      lastVisitRecord.temperature ? `Temp ${lastVisitRecord.temperature} °${lastVisitRecord.temperatureUnit ?? "F"}` : "",
      lastVisitRecord.respiratoryRate ? `RR ${lastVisitRecord.respiratoryRate}` : "",
      lastVisitRecord.weight ? `Wt ${lastVisitRecord.weight} kg` : "",
      lastVisitRecord.oxygenSaturation ? `SpO2 ${lastVisitRecord.oxygenSaturation}%` : "",
    ].filter(Boolean)
    : []

  return (
    <div className="flex flex-col gap-4 pb-36">
      <DashboardPageHeader
        title={`Consultation — ${patient.name} (${patient.mrNumber})`}
        action={
          <div className="flex items-center gap-3">
            {(draftSavedAt || isDirty) && <span className="text-xs text-[var(--cp-ink-soft)]">{draftSavedAt ? `Draft saved ${draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Unsaved changes"}{draftSavedAt && isDirty ? " · Unsaved changes" : ""}</span>}
            <Button variant="outline" size="sm" disabled={!completed || status !== "Signed"} onClick={printPrescription}>
              <Printer className="h-4 w-4" /> Print Prescription
            </Button>
          </div>
        }
      />
      {concurrencyError && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm flex items-center justify-between">
          <div>
            <p className="font-semibold">{concurrencyError}</p>
            <p className="text-xs text-red-700 mt-1">Your typed text has not been lost. You can copy your notes or reload to see the latest version.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="border-red-300 bg-white hover:bg-red-100 text-red-900 font-medium">
            Reload
          </Button>
        </div>
      )}
      {currentUser?.role === "doctor" && !doctorProfile?.pmdcRegistrationNo && !doctorProfile?.registrationNumber && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Add your registration number in Settings to include it on prescriptions.
        </div>
      )}

      <Card className={cn("border-l-4", patientAllergies.length > 0 ? "border-l-[var(--cp-critical)]" : "border-l-[var(--cp-primary)]")}>
        <CardHeader className="pb-2"><CardTitle>Patient Summary</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Allergies</p><p className={patientAllergies.length ? "font-semibold text-[var(--cp-critical)]" : ""}>{patientAllergies.length ? patientAllergies.join(", ") : "No known allergies"}</p></div>
            <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Chronic conditions / history</p><p>{clinicalSummary?.chronicConditions.join(", ") || clinicalSummary?.medicalHistory || patient.notes || "None recorded"}</p></div>
            <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Last visit</p><p>{patient.lastVisit ? formatDate(patient.lastVisit) : lastVisitRecord?.updatedAt ? formatDate(lastVisitRecord.updatedAt) : "No previous visit"}</p></div>
            <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Last recorded vitals</p><p>{lastVitals.length ? lastVitals.join(" · ") : "No previous vitals"}</p></div>
          </div>
          <button onClick={() => setHistoryOpen((v) => !v)} className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]">
            Full medical history {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <Button className="ml-2 mt-3" size="sm" variant="outline" onClick={() => { setHistoryOpen(true); setHistoryEditing(true) }}>Edit history</Button>
          {historyOpen && <div className="mt-2 rounded-lg bg-[var(--cp-bg)] p-3 text-sm text-[var(--cp-ink-soft)]">
            {clinicalSummaryError ? <div role="alert" className="flex items-center gap-2 text-[var(--cp-critical)]"><span>{clinicalSummaryError}</span><Button size="sm" variant="outline" onClick={() => setClinicalSummaryRetry((value) => value + 1)}>Retry</Button></div> : !clinicalSummary ? <p role="status">Loading clinical history…</p> : <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p>Blood group: {formatBloodGroup(patient.bloodGroup)}. {clinicalSummary.medicalHistory || patient.notes || "No additional history recorded."}</p>
                {historyEditing && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setHistoryEditing(false)}>Cancel</Button><Button size="sm" disabled={savingHistory} onClick={() => void saveClinicalHistory()}>{savingHistory ? "Saving..." : "Save history"}</Button></div>}
              </div>
              {historyEditing && <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <div><Label htmlFor="edit-patient-allergies">Allergies</Label><Input id="edit-patient-allergies" aria-label="Edit patient allergies" value={allergyDraft} onChange={(event) => setAllergyDraft(event.target.value)} /></div>
                <div><Label htmlFor="edit-patient-conditions">Chronic conditions</Label><Input id="edit-patient-conditions" aria-label="Edit patient chronic conditions" value={chronicConditionsDraft} onChange={(event) => setChronicConditionsDraft(event.target.value)} /></div>
              </div>}
              {clinicalSummary.visits.length > 0 && <ul className="mb-3 flex flex-col gap-1">{clinicalSummary.visits.map((visit) => <li key={visit.appointmentId}>{formatDate(visit.date)}{visit.diagnosis ? ` · ${visit.diagnosis}` : ""}</li>)}</ul>}
            </>}
          </div>}
          {clinicalSummary?.labResults.length || clinicalSummary?.ultrasounds.length ? <details className="mt-2 rounded-lg border border-[var(--cp-border)] p-3 text-sm">
            <summary className="cursor-pointer font-medium">Recent labs &amp; ultrasounds</summary>
            <ul className="mt-2 flex flex-col gap-1">{clinicalSummary.labResults.map((item, index) => <li key={`lab-${index}`}>{item.test}{item.result ? ` · ${item.result}` : ""}</li>)}{clinicalSummary.ultrasounds.map((item) => <li key={item.id}>{item.type}{item.result ? ` · ${item.result}` : ""}</li>)}</ul>
          </details> : null}
          {clinicalSummary?.previouslyPrescribedMedicines.length ? <details className="mt-2 rounded-lg border border-[var(--cp-border)] p-3 text-sm">
            <summary className="cursor-pointer font-medium">Previous medicines</summary>
            <ul className="mt-2 flex flex-col gap-1">{clinicalSummary.previouslyPrescribedMedicines.map((item) => <li key={`${item.medicineId ?? item.name}-${item.date}`}>{item.name} · {item.dose} · {item.frequency} · {item.duration}</li>)}</ul>
            <Button className="mt-2" size="sm" variant="outline" onClick={repeatPreviousPrescription}>Repeat last prescription</Button>
          </details> : null}
        </CardContent>
      </Card>

      {completed && remoteConsultation && <Card>
        <CardHeader><CardTitle>Addendum</CardTitle></CardHeader>
        <CardContent>
          {(remoteConsultation.addenda ?? []).map((item) => <div key={item.id} className="mb-2 rounded-lg bg-[var(--cp-bg)] p-3 text-sm"><p>{item.note}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{item.author.name} · {formatDate(item.createdAt)} {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>)}
          {addendumOpen ? <div className="flex flex-col gap-2"><Textarea aria-label="Addendum note" autoComplete="off" value={addendumText} onChange={(event) => setAddendumText(event.target.value)} placeholder="Add a dated note to the completed consultation" /><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setAddendumOpen(false)}>Cancel</Button><Button size="sm" disabled={!addendumText.trim() || savingAddendum} onClick={saveAddendum}>{savingAddendum ? "Saving..." : "Save Addendum"}</Button></div></div> : <Button variant="outline" size="sm" onClick={() => setAddendumOpen(true)}>Add Addendum</Button>}
        </CardContent>
      </Card>}

      {/* Vitals */}
      <Card>
        <CardHeader><CardTitle>Vitals</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
          {criticalList.length > 0 && (
            <div role="alert" className="col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 sm:col-span-4">
              <p className="font-semibold text-red-800">Critical vital values detected:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                {criticalList.map((c) => (
                  <li key={c.key}>Critical value: {c.label} {c.value}{c.unit}</li>
                ))}
              </ul>
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs font-medium text-red-900">
                <input
                  type="checkbox"
                  autoComplete="off"
                  checked={criticalConfirmed}
                  onChange={(e) => setCriticalConfirmed(e.target.checked)}
                  className="rounded border-red-400 text-red-600 focus:ring-red-500"
                />
                I confirm these values are correct
              </label>
            </div>
          )}
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-systolic">Systolic (mmHg)</Label>
            <Input id="v-systolic" type="number" inputMode="numeric" autoComplete="off" disabled={locked} value={vitals.systolic} onChange={(e) => setVitals((v) => ({ ...v, systolic: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.systolic)} />
            {vitalErrors.systolic && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.systolic}</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-diastolic">Diastolic (mmHg)</Label>
            <Input id="v-diastolic" type="number" inputMode="numeric" autoComplete="off" disabled={locked} value={vitals.diastolic} onChange={(e) => setVitals((v) => ({ ...v, diastolic: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.diastolic)} />
            {vitalErrors.diastolic && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.diastolic}</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-pulse">Pulse (bpm)</Label>
            <Input id="v-pulse" type="number" inputMode="numeric" autoComplete="off" disabled={locked} value={vitals.pulse} onChange={(e) => setVitals((v) => ({ ...v, pulse: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.pulse)} />
            {vitalErrors.pulse && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.pulse}</p>}
            {!vitalErrors.pulse && vitals.pulse && (Number(vitals.pulse) < VITAL_WARNINGS.lowPulse || Number(vitals.pulse) > VITAL_WARNINGS.highPulse) && <p className="mt-1 text-xs text-amber-700">Abnormal pulse; verify and assess.</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-temperature">Temperature</Label>
            <div className="flex gap-1">
              <Input id="v-temperature" type="number" step="0.1" inputMode="decimal" autoComplete="off" disabled={locked} value={vitals.temperature} onChange={(e) => setVitals((v) => ({ ...v, temperature: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.temperature)} />
              <Select aria-label="Temperature unit" autoComplete="off" disabled={locked} value={vitals.temperatureUnit} onChange={(e) => setVitals((v) => ({ ...v, temperatureUnit: e.target.value as TemperatureUnit }))} className="h-8 min-h-0 w-16 px-1 text-sm">
                <option value="F">°F</option><option value="C">°C</option>
              </Select>
            </div>
            {vitalErrors.temperature && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.temperature}</p>}
            {!vitalErrors.temperature && vitals.temperature && temperatureValue > feverThreshold && <p className="mt-1 text-xs text-amber-700">High temperature; assess for fever.</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-respiratoryRate">Respiratory rate (/min)</Label>
            <Input id="v-respiratoryRate" type="number" inputMode="numeric" autoComplete="off" disabled={locked} value={vitals.respiratoryRate} onChange={(e) => setVitals((v) => ({ ...v, respiratoryRate: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.respiratoryRate)} />
            {vitalErrors.respiratoryRate && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.respiratoryRate}</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-weight">Weight (kg)</Label>
            <Input id="v-weight" type="number" step="0.1" inputMode="decimal" autoComplete="off" disabled={locked} value={vitals.weight} onChange={(e) => setVitals((v) => ({ ...v, weight: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.weight)} />
            {vitalErrors.weight && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.weight}</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-spo2">SpO2 (%)</Label>
            <Input id="v-spo2" type="number" inputMode="numeric" autoComplete="off" disabled={locked} value={vitals.spo2} onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.spo2)} />
            {vitalErrors.spo2 && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.spo2}</p>}
            {!vitalErrors.spo2 && vitals.spo2 && Number(vitals.spo2) < VITAL_WARNINGS.lowOxygenSaturation && <p className="mt-1 text-xs text-amber-700">Low oxygen saturation; assess promptly.</p>}
          </div>
          <div className="min-w-0">
            <Label className="text-xs" htmlFor="v-height">Height (cm)</Label>
            <Input id="v-height" type="number" step="0.1" inputMode="decimal" autoComplete="off" disabled={locked} value={vitals.heightCm} onChange={(e) => setVitals((v) => ({ ...v, heightCm: e.target.value }))} className="cp-tabular h-8 min-h-0 px-2 text-sm" aria-invalid={Boolean(vitalErrors.heightCm)} />
            {vitalErrors.heightCm && <p className="mt-1 text-xs text-[var(--cp-critical)]">{vitalErrors.heightCm}</p>}
            {bmi !== null && Number.isFinite(bmi) && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">BMI: {bmi.toFixed(1)}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Consultation notes */}
      <Card>
        <CardHeader><CardTitle>Consultation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cc">Chief Complaint</Label>
            <Textarea id="cc" autoComplete="off" aria-invalid={Boolean(completionErrors.chiefComplaint)} disabled={locked} value={chiefComplaint} onChange={(e) => { setChiefComplaint(e.target.value); setCompletionErrors((errors) => ({ ...errors, chiefComplaint: undefined })) }} />
            {completionErrors.chiefComplaint && <p role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">{completionErrors.chiefComplaint}</p>}
          </div>
          <div>
            <Label htmlFor="dx">Diagnosis</Label>
            <Textarea id="dx" autoComplete="off" aria-invalid={Boolean(completionErrors.diagnosis)} disabled={locked} value={diagnosis} onChange={(e) => { setDiagnosis(e.target.value); setCompletionErrors((errors) => ({ ...errors, diagnosis: undefined })) }} />
            {completionErrors.diagnosis && <p role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">{completionErrors.diagnosis}</p>}
          </div>
          <div>
            <Label htmlFor="findings">Findings</Label>
            <Textarea id="findings" autoComplete="off" disabled={locked} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Examination findings" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea id="notes" autoComplete="off" disabled={locked} value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} />
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
          <div className="mb-4 max-w-xs"><Label htmlFor="refill-number">Number of Refills</Label><Select id="refill-number" autoComplete="off" disabled={locked} value={String(refillNumber)} onChange={(event) => setRefillNumber(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} {value === 1 ? "refill" : "refills"}</option>)}</Select></div>
          {duplicateMedicineError && <p role="alert" className="mb-3 text-sm text-[var(--cp-critical)]">{duplicateMedicineError}</p>}
          {prescriptions.length === 0 ? (
            <p className="text-sm text-[var(--cp-ink-soft)]">No medicines added yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {prescriptions.map((row, idx) => (
                <div key={row.id} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-[var(--cp-border)] p-3 sm:grid-cols-6", locked && "bg-[var(--cp-bg)]")}>
                  <div className="relative sm:col-span-2">
                    <Label>Medicine</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      value={row.medicine}
                      onChange={(e) => { updateRow(row.id, { medicine: e.target.value, medicineId: undefined }); setMedicineSearch(e.target.value); setAutocompleteIdx(idx) }}
                      onFocus={() => setAutocompleteIdx(idx)}
                      onBlur={() => setTimeout(() => setAutocompleteIdx(null), 150)}
                      placeholder="Start typing…"
                      aria-label={`Medicine ${idx + 1}`}
                      aria-invalid={Boolean(prescriptionErrors[row.id])}
                    />
                    {prescriptionErrors[row.id] && <p role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">{prescriptionErrors[row.id]}</p>}
                    {getMedicationAllergyMatches(patientAllergies, row.medicine).length > 0 && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">Allergy match: {getMedicationAllergyMatches(patientAllergies, row.medicine).join(", ")}</p>}
                    {autocompleteIdx === idx && row.medicine && medicines.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-lg">
                        {medicines.map((medicine) => {
                          const medicineName = `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`;
                          const stock = medicine.batches.reduce((total, batch) => total + batch.stockQuantity, 0);
                          return (
                            <li key={medicine.id} data-medicine-id={medicine.id}>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--cp-primary-light)]"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  if (confirmMedicineAllergy(row.id, medicineName)) {
                                    updateRow(row.id, {
                                      medicine: medicineName,
                                      medicineId: medicine.id,
                                      doseAmount: row.doseAmount || "1",
                                      doseUnit: row.doseUnit || "tablet",
                                      durationValue: row.durationValue || "3",
                                      durationUnit: row.durationUnit || "days",
                                    });
                                  }
                                  setAutocompleteIdx(null);
                                }}
                              >
                                <span className="font-semibold">{medicine.name}</span>
                                {medicine.strength && ` ${medicine.strength}`}{" "}
                                <span className={cn("float-right text-xs", stock ? "text-[var(--cp-success)]" : "text-[var(--cp-critical)]")}>
                                  {stock ? `${stock} in stock` : "Not in stock"}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1"><div><Label htmlFor={`dose-${row.id}`}>Dose</Label><Input id={`dose-${row.id}`} autoComplete="off" type="number" min="0.1" step="0.1" disabled={locked} value={row.doseAmount ?? ""} onChange={(e) => updateRow(row.id, { doseAmount: e.target.value })} placeholder="1" /></div><div><Label htmlFor={`dose-unit-${row.id}`}>Unit</Label><Select id={`dose-unit-${row.id}`} autoComplete="off" disabled={locked} value={row.doseUnit ?? "tablet"} onChange={(e) => updateRow(row.id, { doseUnit: e.target.value })} className="min-w-[7rem]">{DOSE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select></div></div>
                  <div><Label htmlFor={`route-${row.id}`}>Route</Label>
                    <Select id={`route-${row.id}`} autoComplete="off" disabled={locked} value={row.route} onChange={(e) => updateRow(row.id, { route: e.target.value })}>
                      {ROUTE_OPTIONS.map((route) => <option key={route} value={route}>{route}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor={`frequency-${row.id}`}>Frequency</Label><Select id={`frequency-${row.id}`} autoComplete="off" disabled={locked} value={row.frequencyCode ?? "OD"} onChange={(e) => updateRow(row.id, { frequencyCode: e.target.value, legacyFrequency: undefined })}>{FREQUENCY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.code} — {option.description}</option>)}</Select>{row.legacyFrequency && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Legacy value: {row.legacyFrequency}</p>}</div>
                  <div className="flex items-end gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-1"><div><Label htmlFor={`duration-${row.id}`}>Duration</Label><Input id={`duration-${row.id}`} autoComplete="off" type="number" min="1" step="1" disabled={locked} value={row.durationValue ?? ""} onChange={(e) => updateRow(row.id, { durationValue: e.target.value })} placeholder="5" /></div><div><Label htmlFor={`duration-unit-${row.id}`}>Unit</Label><Select id={`duration-unit-${row.id}`} autoComplete="off" disabled={locked} value={row.durationUnit ?? "days"} onChange={(e) => updateRow(row.id, { durationUnit: e.target.value as PrescriptionItem["durationUnit"] })} className="min-w-[7rem]">{DURATION_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select></div></div>
                    {!locked && <button onClick={() => removeRow(row.id)} aria-label="Remove row" className="mb-0.5 rounded-lg p-2 text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <div className="sm:col-span-6"><Label>Instructions</Label><Input autoComplete="off" disabled={locked} value={row.instructions ?? ""} onChange={(e) => updateRow(row.id, { instructions: e.target.value })} placeholder="Optional instructions" /><div className="mt-1 flex flex-wrap gap-1">{["After meals", "Before meals", "At bedtime"].map((instruction) => <button key={instruction} type="button" disabled={locked} className="rounded-full border border-[var(--cp-border)] px-2 py-1 text-xs hover:border-[var(--cp-primary)]" onClick={() => updateRow(row.id, { instructions: row.instructions ? `${row.instructions}, ${instruction}` : instruction })}>{instruction}</button>)}</div></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lab recommendations */}
      <Card>
        <CardHeader><CardTitle>Suggest Lab Tests</CardTitle></CardHeader>
        <CardContent>
          <Input autoComplete="off" aria-label="Search lab tests" placeholder="Search lab catalog..." value={labSearch} onChange={(event) => setLabSearch(event.target.value)} className="mb-3 max-w-sm" />
          <div className="flex flex-wrap gap-2">
            {labTests.filter((test) => test.testName.toLowerCase().includes(labSearch.toLowerCase())).map((test) => (
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Suggest Ultrasound</CardTitle></CardHeader>
        <CardContent>
          <Input autoComplete="off" aria-label="Search ultrasound catalog" placeholder="Search ultrasound catalog..." value={ultrasoundSearch} onChange={(event) => setUltrasoundSearch(event.target.value)} className="mb-3 max-w-sm" />
          <div className="mb-3 flex flex-wrap gap-2">{ultrasoundTypes.map((type) => <button key={type} type="button" disabled={locked} onClick={() => toggleUltrasound(type)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", ultrasoundRecs.includes(type) ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]")}>{type}</button>)}</div>
          <div className="flex flex-wrap gap-2">{ultrasoundTemplates.map((template) => template.examinationType).filter((type, index, all) => all.indexOf(type) === index && type.toLowerCase().includes(ultrasoundSearch.toLowerCase()) && !ultrasoundTypes.includes(type)).map((type) => <button key={type} type="button" disabled={locked} onClick={() => toggleUltrasound(type)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", ultrasoundRecs.includes(type) ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]")}>{type}</button>)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Follow-up &amp; Referral</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fu">Follow-up Date</Label>
            <Input id="fu" type="date" autoComplete="off" disabled={locked} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            {followUp && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" autoComplete="off" disabled={locked} checked={followUpAppointment} onChange={(event) => setFollowUpAppointment(event.target.checked)} />Create follow-up appointment automatically</label>}
          </div>
          <div>
            <Label htmlFor="fu-instructions">Follow-up Instructions</Label>
            <Textarea id="fu-instructions" rows={2} autoComplete="off" disabled={locked} value={followUpInstructions} onChange={(e) => setFollowUpInstructions(e.target.value)} placeholder="e.g. Bring lab reports, monitor blood pressure daily" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ref">Referral</Label>
            <Input id="ref" autoComplete="off" disabled={locked} value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="e.g. Refer to Nephrology" />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 shadow-lg print:hidden">
        <Button variant="outline" size="sm" onClick={() => void saveDraft()} disabled={locked}><Save className="h-4 w-4" /> Save Draft</Button>
        <Button variant="outline" size="sm" onClick={signPrescription} disabled={locked}><PenLine className="h-4 w-4" /> Sign Prescription</Button>
        <Button size="sm" onClick={completeConsultation} disabled={completed}><CheckCircle2 className="h-4 w-4" /> {completed ? "Consultation Completed" : "Complete Consultation"}</Button>
      </div>
    </div>
  )
}