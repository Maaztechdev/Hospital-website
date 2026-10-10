import * as React from "react"
import { Modal } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Appointment, Patient } from "@/dashboard/types"
import { PatientSearchSelect } from "@/dashboard/components/PatientSearchSelect"
import { api, toAppointment, type ApiError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

function getHospitalDateKey(date: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

function formatToastDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1]
  return `${match[3]} ${monthName}`
}

export function BookAppointmentModal({
  open,
  onClose,
  onBooked,
  prefillMR,
}: {
  open: boolean
  onClose: () => void
  onBooked?: (appointmentId: string) => void
  prefillMR?: string
}) {
  const { patients, doctors, appointments, dispatch } = useDashboard()
  const { toast } = useToast()

  const [patient, setPatient] = React.useState<Patient | null>(null)
  const [doctorId, setDoctorId] = React.useState(doctors[0]?.id ?? "")
  const [date, setDate] = React.useState(getHospitalDateKey())
  const [time, setTime] = React.useState("")
  const [type, setType] = React.useState<Appointment["type"]>("New Visit")
  const [priority, setPriority] = React.useState<Appointment["priority"]>("Routine")
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [availableSlots, setAvailableSlots] = React.useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = React.useState(false)
  const initializedForRef = React.useRef<string | null>(null)

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
      .catch((cause) => { setAvailableSlots([]); toast({ title: "Unable to load available slots", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }) })
      .finally(() => setLoadingSlots(false))
  }, [open, doctorId, date, toast])

  React.useEffect(() => {
    if (!open) { initializedForRef.current = null; return }
    const prefillKey = prefillMR ?? ""
    if (initializedForRef.current === prefillKey) return
    initializedForRef.current = prefillKey
    setPatient(patients.find((candidate) => candidate.mrNumber === prefillMR) ?? null)
    setTime("")
    setError(null)
  }, [open, prefillMR, patients])

  const doctor = doctors.find((d) => d.id === doctorId)

  async function submit() {
    if (!patient) { setError("Select a patient to continue."); return }
    if (!time) { setError("Choose an available time slot."); return }
    setError(null)

    if (!patient.id) { setError("Select a registered patient."); return }
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
      onBooked?.(appointment.id)
      toast({
        title: `Appointment ${appointment.status.toLowerCase()}`,
        description: `Token #${appointment.token} for ${appointment.doctorName} on ${formatToastDate(appointment.date)}, ${appointment.time}`,
        variant: "success",
      })
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
          <PatientSearchSelect value={patient} onChange={(selected) => { setPatient(selected); setError(null) }} prefillMR={prefillMR} error={error && !patient ? error : undefined} />
        </div>

        <div>
          <Label htmlFor="bk-doctor">Doctor</Label>
          <Select id="bk-doctor" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime("") }}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.department}</option>)}
          </Select>
        </div>

        <div>
          <Label htmlFor="bk-date">Date</Label>
          <Input id="bk-date" type="date" min={getHospitalDateKey()} value={date} onChange={(e) => { setDate(e.target.value); setTime("") }} />
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
            <p className="text-xs text-[var(--cp-ink-soft)]">No slots available</p>
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
