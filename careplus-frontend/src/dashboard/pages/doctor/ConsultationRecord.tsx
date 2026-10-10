import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api, openAuthenticatedPrintWindow, type ApiConsultation, type ApiError } from "@/lib/api"

function recorded(value: number | string | null | undefined, suffix = "") {
  return value == null ? "Not recorded" : `${value}${suffix}`
}

function displayDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded"
}

export default function ConsultationRecord() {
  const { consultationId = "" } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [consultation, setConsultation] = React.useState<ApiConsultation | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [addendum, setAddendum] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      setConsultation(await api.getConsultation(consultationId))
    } catch (cause) {
      setError((cause as ApiError).message || "Could not load this consultation record.")
    } finally {
      setLoading(false)
    }
  }, [consultationId])

  React.useEffect(() => { void load() }, [load])

  async function saveAddendum() {
    const note = addendum.trim()
    if (!note || !consultation) return
    setSaving(true)
    try {
      const created = await api.addConsultationAddendum(consultation.id, note)
      setConsultation({ ...consultation, addenda: [...(consultation.addenda ?? []), created] })
      setAddendum("")
      toast({ title: "Addendum saved", description: "The completed consultation remains unchanged.", variant: "success" })
    } catch (cause) {
      toast({ title: "Could not save addendum", description: (cause as ApiError).message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-[var(--cp-ink-soft)]">Loading consultation record…</div>
  if (error || !consultation) return (
    <div className="flex flex-col gap-3 p-6">
      <p role="alert" className="text-sm text-[var(--cp-critical)]">{error || "Consultation record not found."}</p>
      <Button variant="outline" className="w-fit" onClick={() => void load()}>Retry</Button>
    </div>
  )

  const patientName = `${consultation.patient?.firstName ?? ""} ${consultation.patient?.lastName ?? ""}`.trim() || "Patient"

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Consultation Record" />
      <Card><CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <h2 className="text-lg font-bold text-[var(--cp-ink)]">{patientName}</h2>
          <p className="text-sm text-[var(--cp-ink-soft)]">{consultation.patient?.mrNumber ?? "MR not recorded"} · Token #{consultation.appointment?.tokenNumber ?? "—"} · {consultation.appointment?.appointmentDate ?? "Date not recorded"}</p>
          <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Dr. {consultation.doctor?.user.name ?? "Not recorded"} · {consultation.doctor?.department?.name ?? "Department not recorded"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={consultation.prescriptionStatus === "SIGNED" || consultation.prescriptionStatus === "COMPLETED" ? "Signed · Locked" : "Read-only"} />
          {consultation.prescriptionStatus !== "DRAFT" && (
            <Button variant="outline" onClick={() => {
              if (!openAuthenticatedPrintWindow(`/print/prescription/${consultation.id}`)) {
                toast({ title: "Allow pop-ups to print", description: "Your browser blocked the prescription print page. Allow pop-ups and try again.", variant: "error" })
              }
            }}>Print Prescription</Button>
          )}
          <Button variant="outline" onClick={() => navigate(`/dashboard/patients/${consultation.patient?.mrNumber ?? ""}`)}>Patient Profile</Button>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <h3 className="mb-3 font-semibold text-[var(--cp-ink)]">Vitals {consultation.vitalsEstimated && <span className="text-xs font-normal text-[var(--cp-warning)]">(estimated)</span>}</h3>
        {consultation.isCritical && <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Critical vitals</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Blood pressure</dt><dd>{recorded(consultation.bpSystolic)}{consultation.bpSystolic == null ? "" : ` / ${recorded(consultation.bpDiastolic)} mmHg`}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Pulse</dt><dd>{recorded(consultation.pulse, " bpm")}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Temperature</dt><dd>{recorded(consultation.temperature, consultation.temperatureUnit === "C" ? " °C" : " °F")}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Respiratory rate</dt><dd>{recorded(consultation.respiratoryRate, " /min")}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Weight</dt><dd>{recorded(consultation.weight, " kg")}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">SpO₂</dt><dd>{recorded(consultation.oxygenSaturation, "%")}</dd></div>
          <div><dt className="text-xs text-[var(--cp-ink-soft)]">Height</dt><dd>{recorded(consultation.heightCm, " cm")}</dd></div>
        </dl>
      </CardContent></Card>

      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        <section><h3 className="font-semibold">Chief complaint</h3><p className="mt-1 whitespace-pre-wrap text-sm">{consultation.chiefComplaint || "Not recorded"}</p></section>
        <section><h3 className="font-semibold">Diagnosis</h3><p className="mt-1 whitespace-pre-wrap text-sm">{consultation.diagnosis || "Not recorded"}</p></section>
        <section><h3 className="font-semibold">Findings</h3><p className="mt-1 whitespace-pre-wrap text-sm">{consultation.findings || "Not recorded"}</p></section>
        <section><h3 className="font-semibold">Clinical notes</h3><p className="mt-1 whitespace-pre-wrap text-sm">{consultation.clinicalNotes || "Not recorded"}</p></section>
        <section><h3 className="font-semibold">Follow-up</h3><p className="mt-1 text-sm">{consultation.followUpDate ? displayDate(consultation.followUpDate) : "Not recorded"}</p></section>
        <section><h3 className="font-semibold">Referral</h3><p className="mt-1 whitespace-pre-wrap text-sm">{consultation.referral || "Not recorded"}</p></section>
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <h3 className="mb-3 font-semibold">Prescription</h3>
        {(consultation.prescriptions ?? []).length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No prescription recorded.</p> : (
          <div className="flex flex-col gap-3">
            {(consultation.prescriptions ?? []).map((prescription) => (
              <div key={prescription.id} className="rounded-lg border border-[var(--cp-border)] p-3">
                <p className="mb-2 text-xs text-[var(--cp-ink-soft)]">{prescription.status === "DRAFT" ? "Draft" : "Signed and locked"}{prescription.signedAt ? ` · ${displayDate(prescription.signedAt)}` : ""}</p>
                {prescription.items.length === 0 ? <p className="text-sm">No medicines.</p> : prescription.items.map((item) => (
                  <p key={item.id} className="py-1 text-sm">{item.medicineName} — {item.doseAmount ?? item.dosage} {item.doseUnit ?? ""}, {item.route}, {item.frequency}, {item.durationValue ?? item.durationDays} {item.durationUnit ?? "days"}</p>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="grid gap-5 p-5 sm:grid-cols-2">
        <section><h3 className="mb-2 font-semibold">Suggested laboratory tests</h3>{(consultation.labOrders ?? []).length ? <ul className="list-disc pl-5 text-sm">{consultation.labOrders?.map((order) => <li key={order.id}>{order.test.testName} · {order.status} · {displayDate(order.orderedAt)}</li>)}</ul> : <p className="text-sm text-[var(--cp-ink-soft)]">None recorded.</p>}</section>
        <section><h3 className="mb-2 font-semibold">Suggested ultrasounds</h3>{(consultation.ultrasoundOrders ?? []).length ? <ul className="list-disc pl-5 text-sm">{consultation.ultrasoundOrders?.map((order) => <li key={order.id}>{order.examType} · {order.status} · {displayDate(order.createdAt)}{order.impression ? ` · ${order.impression}` : ""}</li>)}</ul> : <p className="text-sm text-[var(--cp-ink-soft)]">None recorded.</p>}</section>
      </CardContent></Card>

      <Card><CardContent className="p-5">
        <h3 className="mb-3 font-semibold">Addenda</h3>
        {(consultation.addenda ?? []).length === 0 ? <p className="mb-3 text-sm text-[var(--cp-ink-soft)]">No addenda recorded.</p> : (
          <ol className="mb-4 flex flex-col gap-2">{consultation.addenda?.map((entry) => <li key={entry.id} className="rounded-lg bg-[var(--cp-bg)] p-3"><p className="whitespace-pre-wrap text-sm">{entry.note}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{entry.author.name} · {displayDate(entry.createdAt)}</p></li>)}</ol>
        )}
        {consultation.prescriptionStatus === "COMPLETED" && (
          <div className="flex flex-col gap-2">
            <label htmlFor="consultation-addendum" className="text-sm font-medium">Add an addendum</label>
            <textarea id="consultation-addendum" value={addendum} onChange={(event) => setAddendum(event.target.value)} rows={3} className="rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 text-sm" placeholder="Document a post-completion correction or clarification" />
            <Button className="w-fit" disabled={!addendum.trim() || saving} onClick={() => void saveAddendum()}>{saving ? "Saving…" : "Add Addendum"}</Button>
          </div>
        )}
      </CardContent></Card>
    </div>
  )
}
