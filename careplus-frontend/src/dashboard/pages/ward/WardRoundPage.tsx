import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { api, toAdmission, type ApiAdmission, type ApiConsultation, type ApiDoctorWardRoundToday, type ApiLabTest, type ApiPatientVitals, type ApiWardRound } from "@/lib/api"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { DischargeModal } from "@/dashboard/pages/ward/DischargeModal"
import { ScheduleSurgeryModal } from "@/dashboard/pages/ot/ScheduleSurgeryModal"
import type { Bed } from "@/dashboard/types"

const fieldClass = "w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-sm"

export default function WardRoundPage() {
  const { admissionId = "" } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { refreshWardState } = useDashboard()
  const [admission, setAdmission] = useState<ApiAdmission | null>(null)
  const [summary, setSummary] = useState<ApiDoctorWardRoundToday | null>(null)
  const [rounds, setRounds] = useState<ApiWardRound[]>([])
  const [vitals, setVitals] = useState<ApiPatientVitals[]>([])
  const [tests, setTests] = useState<ApiLabTest[]>([])
  const [editableConsultation, setEditableConsultation] = useState<ApiConsultation | null>(null)
  const [testId, setTestId] = useState("")
  const [ultrasound, setUltrasound] = useState("")
  const [vitalInput, setVitalInput] = useState({ bpSystolic: "", bpDiastolic: "", pulse: "", temperature: "", respiratoryRate: "", oxygenSaturation: "" })
  const [note, setNote] = useState({ subjective: "", findings: "", assessment: "", plan: "" })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [dischargeOpen, setDischargeOpen] = useState(false)
  const [surgeryOpen, setSurgeryOpen] = useState(false)
  const { currentUser, doctors } = useDashboard()

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [admissionData, roundData, vitalData, testData, todayData, consultationData] = await Promise.all([
        api.getAdmission(admissionId),
        api.listWardRounds(admissionId),
        api.listVitalsHistory(admissionId),
        api.listLabTests(),
        api.getMyWardRoundsToday(),
        api.listConsultations(),
      ])
      setAdmission(admissionData)
      setRounds(roundData)
      setVitals(vitalData)
      setTests(testData.filter((test) => test.isActive))
      setSummary(todayData.find((item) => item.id === admissionId) ?? null)
      setEditableConsultation(consultationData.find((item) => (
        item.patientId === admissionData.patientId && item.prescriptionStatus === "DRAFT"
      )) ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ward round data could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [admissionId])

  useEffect(() => { void load() }, [load])

  const occupiedBed = useMemo<Bed | null>(() => admission ? {
    id: admission.bed.id,
    bedNumber: admission.bed.bedNumber,
    ward: admission.bed.room.ward.wardType === "ICU" ? "ICU" : admission.bed.room.ward.wardType === "PRIVATE" ? "Private Room" : "General Ward",
    room: admission.bed.room.roomNumber,
    status: "Occupied",
    dailyRate: Number(admission.bed.dailyRate),
    admissionId: admission.id,
    mrNumber: admission.patient.mrNumber,
    patientName: `${admission.patient.firstName} ${admission.patient.lastName}`,
    doctorName: admission.attendingDoctor?.user.name,
    admittedAt: admission.admissionDate,
  } : null, [admission])

  async function saveRound() {
    if (!admission) return
    if (!Object.values(note).some((value) => value.trim())) {
      toast({ title: "Round note required", description: "Enter complaints, findings, assessment, or plan before saving.", variant: "error" })
      return
    }
    setBusy(true)
    try {
      await api.createWardRound(admission.id, note)
      setNote({ subjective: "", findings: "", assessment: "", plan: "" })
      await load()
      toast({ title: "Ward round saved", description: "This entry has been added to the patient’s round history.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to save ward round", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function saveVitals() {
    if (!admission) return
    const values = Object.fromEntries(Object.entries(vitalInput).filter(([, value]) => value.trim()).map(([key, value]) => [key, Number(value)]))
    if (!Object.keys(values).length) {
      toast({ title: "Vitals required", description: "Enter at least one measurement before saving.", variant: "error" })
      return
    }
    if (Object.values(values).some((value) => !Number.isFinite(value))) {
      toast({ title: "Invalid vitals", description: "Enter valid numeric measurements.", variant: "error" })
      return
    }
    setBusy(true)
    try {
      await api.recordVitals({ admissionId: admission.id, ...values })
      setVitalInput({ bpSystolic: "", bpDiastolic: "", pulse: "", temperature: "", respiratoryRate: "", oxygenSaturation: "" })
      await load()
      toast({ title: "Vitals recorded", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to record vitals", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function orderLab() {
    if (!admission || !testId) return
    setBusy(true)
    try {
      await api.createLabOrder({ patientId: admission.patientId, testId })
      await load()
      toast({ title: "Lab ordered", description: "The order is now in the patient’s lab queue.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to order lab", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function orderUltrasound() {
    if (!admission || !ultrasound.trim()) return
    setBusy(true)
    try {
      await api.createUltrasoundOrder({ patientId: admission.patientId, examType: ultrasound.trim() })
      setUltrasound("")
      await load()
      toast({ title: "Ultrasound ordered", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to order ultrasound", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function setReady(ready: boolean) {
    if (!admission) return
    setBusy(true)
    try {
      await api.setAdmissionReadyForDischarge(admission.id, ready)
      await Promise.all([load(), refreshWardState()])
      toast({ title: ready ? "Marked ready for discharge" : "Discharge readiness removed", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to update discharge readiness", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !admission) return <div className="space-y-4" aria-label="Loading ward round"><div className="h-20 animate-pulse rounded-xl bg-[var(--cp-surface-muted)]" /><div className="h-44 animate-pulse rounded-xl bg-[var(--cp-surface-muted)]" /><div className="h-64 animate-pulse rounded-xl bg-[var(--cp-surface-muted)]" /></div>
  if (error || !admission) return <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><AlertTriangle className="h-8 w-8 text-[var(--cp-critical)]" /><p>{error || "Admission not found."}</p><Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Retry</Button></CardContent></Card>

  const patientName = `${admission.patient.firstName} ${admission.patient.lastName}`
  const attendingDoctor = doctors.find((doctor) => doctor.userId === currentUser?.id)
  const latestVitals = vitals[0]
  const dischargeAdmission = toAdmission(admission)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/doctor")}><ArrowLeft className="h-4 w-4" /> Dashboard</Button>
          <h1 className="mt-2 text-2xl font-bold">{patientName} <span className="text-base font-normal text-[var(--cp-ink-soft)]">· {admission.patient.mrNumber}</span></h1>
          <p className="text-sm text-[var(--cp-ink-soft)]">{admission.bed.room.ward.wardName}, Room {admission.bed.room.roomNumber}, Bed {admission.bed.bedNumber} · {summary?.daysAdmitted === 0 ? "Today" : `${summary?.daysAdmitted ?? 0} day(s) admitted`}</p>
          {admission.patient.allergies?.length ? <div className="mt-2 flex flex-wrap gap-1">{admission.patient.allergies.map((allergy) => <span key={allergy} className="rounded-full bg-[var(--cp-critical-light)] px-2 py-1 text-xs font-semibold text-[var(--cp-critical)]">Allergy: {allergy}</span>)}</div> : <p className="mt-2 text-xs text-[var(--cp-ink-faint)]">Allergies: Not recorded</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSurgeryOpen(true)}>Schedule surgery</Button>
          <Button variant="outline" size="sm" onClick={() => setReady(!admission.readyForDischarge)} disabled={busy}>{admission.readyForDischarge ? "Remove discharge-ready" : "Mark ready for discharge"}</Button>
          <Button size="sm" onClick={() => setDischargeOpen(true)} disabled={admission.status !== "ACTIVE"}>Discharge</Button>
        </div>
      </div>

      {summary?.latestVitals?.isCritical && <div role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm font-semibold text-[var(--cp-critical)]">Critical vitals recorded. Review the latest measurements before proceeding.</div>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Vitals trend</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {vitals.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[
              ["Blood pressure", latestVitals?.bpSystolic != null && latestVitals?.bpDiastolic != null ? `${latestVitals.bpSystolic}/${latestVitals.bpDiastolic} mmHg` : null],
              ["Pulse", latestVitals?.pulse != null ? `${latestVitals.pulse} bpm` : null],
              ["Temperature", latestVitals?.temperature != null ? `${latestVitals.temperature} °F` : null],
              ["Respiratory rate", latestVitals?.respiratoryRate != null ? `${latestVitals.respiratoryRate}/min` : null],
              ["SpO₂", latestVitals?.oxygenSaturation != null ? `${latestVitals.oxygenSaturation}%` : null],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--cp-surface-muted)] p-2"><span className="block text-xs text-[var(--cp-ink-soft)]">{label}</span><strong className="text-sm">{value ?? "Not recorded"}</strong></div>)}</div> : <p className="text-sm text-[var(--cp-ink-soft)]">No vitals have been recorded for this admission.</p>}
            {vitals.length > 1 && <div><h3 className="mb-2 text-xs font-semibold text-[var(--cp-ink-soft)]">Recent readings</h3><ul className="space-y-1 text-xs text-[var(--cp-ink-soft)]">{vitals.slice(0, 5).map((item) => <li key={item.id} className="rounded bg-[var(--cp-surface-muted)] px-2 py-1">{new Date(item.recordedAt).toLocaleString()} · BP {item.bpSystolic ?? "—"}/{item.bpDiastolic ?? "—"} · Pulse {item.pulse ?? "—"} · SpO₂ {item.oxygenSaturation ?? "—"}%</li>)}</ul></div>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["bpSystolic", "Systolic"], ["bpDiastolic", "Diastolic"], ["pulse", "Pulse"], ["temperature", "Temp °F"],
                ["respiratoryRate", "Respiratory rate"], ["oxygenSaturation", "SpO₂"],
              ].map(([key, label]) => <div key={key}><Label htmlFor={`vital-${key}`}>{label}</Label><input id={`vital-${key}`} className={fieldClass} inputMode="decimal" value={vitalInput[key as keyof typeof vitalInput]} onChange={(event) => setVitalInput((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
            </div>
            <Button size="sm" variant="outline" onClick={() => void saveVitals()} disabled={busy}>Record vitals</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Results and current medicines</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><h3 className="mb-2 text-sm font-semibold">Pending labs / ultrasound</h3>
              {(summary?.pendingLabResults.length || summary?.pendingUltrasoundResults.length) ? <ul className="space-y-1 text-sm">{summary?.pendingLabResults.map((item) => <li key={item.id}>{item.test} · {item.status}{item.latestResult && <> · {item.latestResult.resultValue}{item.latestResult.unit ? ` ${item.latestResult.unit}` : ""}{item.latestResult.interpretation ? ` (${item.latestResult.interpretation})` : ""}</>}</li>)}{summary?.pendingUltrasoundResults.map((item) => <li key={item.id}>{item.examType} · {item.status}</li>)}</ul> : <p className="text-sm text-[var(--cp-ink-soft)]">No pending results.</p>}
            </div>
            <div><h3 className="mb-2 text-sm font-semibold">Active medication orders</h3>
              {summary?.activeMedicationOrders.length ? <ul className="space-y-1 text-sm">{summary.activeMedicationOrders.map((item, index) => <li key={`${item.prescriptionId}-${index}`}>{item.name} · {item.dose} · {item.frequency} · {item.durationDays} days</li>)}</ul> : <p className="text-sm text-[var(--cp-ink-soft)]">No signed medicines recorded.</p>}
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-[var(--cp-border)] pt-3">
              <div className="min-w-52 flex-1"><Label htmlFor="ward-round-lab-test">Order lab</Label><select id="ward-round-lab-test" className={fieldClass} value={testId} onChange={(event) => setTestId(event.target.value)}><option value="">Select a test</option>{tests.map((test) => <option key={test.id} value={test.id}>{test.testName}</option>)}</select></div>
              <Button size="sm" variant="outline" onClick={() => void orderLab()} disabled={busy || !testId}>Order lab</Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1"><Label htmlFor="ward-round-ultrasound">Order ultrasound</Label><input id="ward-round-ultrasound" className={fieldClass} value={ultrasound} onChange={(event) => setUltrasound(event.target.value)} placeholder="Exam type" /></div>
              <Button size="sm" variant="outline" onClick={() => void orderUltrasound()} disabled={busy || !ultrasound.trim()}>Order ultrasound</Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--cp-border)] pt-3">
              {attendingDoctor && editableConsultation ? <Link className="inline-flex items-center rounded-lg border px-3 py-2 text-sm" to={`/dashboard/doctor/consultation/${editableConsultation.appointmentId}`}>Prescribe / modify medicines</Link> : <p className="text-xs text-[var(--cp-ink-soft)]">Prescriptions are consultation-linked. No editable draft consultation is available for this patient; signed prescription content remains locked.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Today's round note</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="round-subjective">Complaints / subjective</Label><Textarea id="round-subjective" value={note.subjective} onChange={(event) => setNote({ ...note, subjective: event.target.value })} /></div>
          <div><Label htmlFor="round-findings">Findings / examination</Label><Textarea id="round-findings" value={note.findings} onChange={(event) => setNote({ ...note, findings: event.target.value })} /></div>
          <div><Label htmlFor="round-assessment">Assessment / diagnosis update</Label><Textarea id="round-assessment" value={note.assessment} onChange={(event) => setNote({ ...note, assessment: event.target.value })} /></div>
          <div><Label htmlFor="round-plan">Plan</Label><Textarea id="round-plan" value={note.plan} onChange={(event) => setNote({ ...note, plan: event.target.value })} /></div>
          <div className="md:col-span-2"><Button onClick={() => void saveRound()} disabled={busy}>Save round note</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Previous round notes</CardTitle></CardHeader>
        <CardContent>{rounds.length ? <ol className="space-y-3">{rounds.map((round) => <li key={round.id} className="rounded-lg border border-[var(--cp-border)] p-3"><div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--cp-ink-soft)]"><span>{new Date(round.roundAt).toLocaleString()}</span><span>{round.doctor?.name ?? "Doctor"}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{[["Complaints", round.subjective], ["Findings", round.findings], ["Assessment", round.assessment], ["Plan", round.plan]].filter(([, value]) => value).map(([label, value]) => <p key={label} className="whitespace-pre-wrap text-sm"><strong>{label}: </strong>{value}</p>)}</div></li>)}</ol> : <p className="text-sm text-[var(--cp-ink-soft)]">No previous round notes.</p>}</CardContent>
      </Card>
      {occupiedBed && <DischargeModal bed={occupiedBed} onClose={() => { setDischargeOpen(false); void load() }} open={dischargeOpen} admissionOverride={dischargeAdmission} />}
      <ScheduleSurgeryModal open={surgeryOpen} onClose={() => setSurgeryOpen(false)} onScheduled={() => setSurgeryOpen(false)} initialMrNumber={admission.patient.mrNumber} />
    </div>
  )
}
