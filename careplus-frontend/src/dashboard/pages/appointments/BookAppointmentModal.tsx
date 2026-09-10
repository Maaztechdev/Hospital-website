import * as React from "react"
import { Modal } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Appointment } from "@/dashboard/types"
import { api, toAppointment, type ApiError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export function BookAppointmentModal({
  open,
  onClose,
  prefillMR,
  prefillName,
}: {
  open: boolean
  onClose: () => void
  prefillMR?: string
  prefillName?: string
}) {
  const { patients, doctors, appointments, dispatch } = useDashboard()
  const { toast } = useToast()

  const [mrNumber, setMrNumber] = React.useState(prefillMR ?? "")
  const [doctorId, setDoctorId] = React.useState(doctors[0]?.id ?? "")
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = React.useState("")
  const [type, setType] = React.useState<Appointment["type"]>("New Visit")
  const [priority, setPriority] = React.useState<Appointment["priority"]>("Routine")
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [availableSlots, setAvailableSlots] = React.useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = React.useState(false)

  React.useEffect(() => {
    if (!doctorId && doctors[0]?.id) setDoctorId(doctors[0].id)
  }, [doctorId, doctors])

  // Fetch available slots when doctor or date changes
  React.useEffect(() => {
    if (!open || !doctorId || !date) return
    setLoadingSlots(true)
    setTime("")
    api.getAvailableSlots(doctorId, date)
      .then((result) => setAvailableSlots(result.availableSlots))
      .catch(() => setAvailableSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [open, doctorId, date])

  React.useEffect(() => {
    if (open) {
      setMrNumber(prefillMR ?? "")
      setTime("")
      setError(null)
    }
  }, [open, prefillMR])

  const doctor = doctors.find((d) => d.id === doctorId)
  const patient = patients.find((p) => p.mrNumber === mrNumber)

  async function submit() {
    if (!mrNumber && !prefillName) { setError("Select a patient (MR number) to continue."); return }
    if (!time) { setError("Choose an available time slot."); return }
    setError(null)

    if (!patient?.id) { setError("Select a registered patient using their MR number."); return }
    setSaving(true)
    try {
      const created = await api.createAppointment({
        patientId: patient.id,
        doctorId,
        appointmentDate: date,
        timeSlot: time,
        appointmentType: type === "New Visit" ? "NEW_VISIT" : type === "Follow-up" ? "FOLLOW_UP" : "CONSULTATION",
        priority: priority.toUpperCase(),
        source: "WALK_IN",
        reason: reason || undefined,
      })
      const appointment = toAppointment(created)
      dispatch({ type: "ADD_APPOINTMENT", appointment })
      toast({ title: "Appointment submitted", description: `Token #${appointment.token} is pending approval.`, variant: "success" })
      onClose()
    } catch (requestError) {
      setError((requestError as ApiError).message || "Unable to book appointment")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Book Appointment" description="Doctor-wise slot availability updates live to prevent double-booking." size="lg">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="bk-mr">Patient (MR Number or name)</Label>
          <Input id="bk-mr" value={mrNumber || prefillName || ""} onChange={(e) => setMrNumber(e.target.value)} placeholder="e.g. MR-2026-000101" />
          {patient && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Matched: {patient.name} · {patient.age} yrs · {patient.gender}</p>}
        </div>

        <div>
          <Label htmlFor="bk-doctor">Doctor</Label>
          <Select id="bk-doctor" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime("") }}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.department}</option>)}
          </Select>
        </div>

        <div>
          <Label htmlFor="bk-date">Date</Label>
          <Input id="bk-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime("") }} />
        </div>

        <div>
          <Label htmlFor="bk-type">Visit Type</Label>
          <Select id="bk-type" value={type} onChange={(e) => setType(e.target.value as Appointment["type"])}>
            <option>New Visit</option><option>Follow-up</option><option>Consultation</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="bk-priority">Priority</Label>
          <Select id="bk-priority" value={priority} onChange={(e) => setPriority(e.target.value as Appointment["priority"])}>
            <option>Routine</option><option>Urgent</option><option>Emergency</option>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <Label>Available Slots — {doctor?.name}</Label>
          {loadingSlots ? (
            <p className="text-xs text-[var(--cp-ink-soft)]">Loading available slots…</p>
          ) : availableSlots.length === 0 ? (
            <p className="text-xs text-[var(--cp-ink-soft)]">No slots available for this date</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {availableSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setTime(slot)}
                  title={`Book ${slot}`}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
                    time === slot
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]"
                      : "border-[var(--cp-border)] text-[var(--cp-ink)] hover:border-[var(--cp-primary)]"
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="bk-reason">Reason (optional)</Label>
          <Textarea id="bk-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief reason for visit…" />
        </div>

        {error && <p className="sm:col-span-2 text-xs font-medium text-[var(--cp-critical)]">{error}</p>}
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving}>Confirm Booking</Button>
      </div>
    </Modal>
  )
}
