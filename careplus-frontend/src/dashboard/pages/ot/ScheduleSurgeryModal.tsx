import * as React from "react"
import { AlertTriangle, LoaderCircle } from "lucide-react"
import { Modal, ConfirmDialog, Tabs } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { OT_ROOMS } from "@/dashboard/data/wardData"
import { useToast } from "@/hooks/use-toast"
import { api, toSurgery } from "@/lib/api"
import { formatBloodGroup, formatTime } from "@/dashboard/lib/format"

const SECTIONS = ["Patient & Procedure", "Doctor & Timing", "Notes"]
const PROCEDURE_CATALOG = [
  "Appendectomy", "Caesarean section", "Cholecystectomy", "Coronary artery bypass",
  "Hernia repair", "Hysterectomy", "Knee replacement", "Laparoscopic cholecystectomy",
  "Cataract surgery", "Fracture fixation",
]
const TIME_SLOTS = Array.from({ length: 96 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, "0")
  const minute = String((index % 4) * 15).padStart(2, "0")
  return `${hour}:${minute}`
})
const HOSPITAL_TIME_ZONE = "Asia/Karachi"

function getHospitalClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  }
}

function addHospitalDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`
}

function nextDefaultSlot(now = new Date()) {
  const current = getHospitalClock(now)
  const nextQuarterHour = Math.floor(current.minutes / 15) * 15 + 15
  const firstSlotToday = Math.max(8 * 60, nextQuarterHour)
  const lastSlotForDefaultDuration = 20 * 60 - 60
  if (firstSlotToday <= lastSlotForDefaultDuration) {
    return {
      date: current.date,
      time: `${String(Math.floor(firstSlotToday / 60)).padStart(2, "0")}:${String(firstSlotToday % 60).padStart(2, "0")}`,
    }
  }
  return { date: addHospitalDays(current.date, 1), time: "08:00" }
}

function timestampAtHospitalTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:00`)
}

function formatHospitalTimestamp(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00"
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}+05:00`
}

function timingValidationMessage(input: {
  patientId?: string
  procedureName: string
  surgeonId: string
  roomId?: string
  date: string
  time: string
  duration: number
  priority: "ELECTIVE" | "URGENT" | "EMERGENCY"
  anesthesiaType: string
}) {
  if (!input.patientId) return "Select a valid patient."
  if (!input.procedureName.trim()) return "Procedure name is required."
  if (!input.surgeonId) return "Select a surgeon."
  if (!input.roomId) return "Select an operating room."
  if (!input.date || !input.time) return "Select a date and time."
  if (!Number.isInteger(input.duration) || input.duration < 15 || input.duration % 15 !== 0) return "Duration must be a positive multiple of 15 minutes."
  if (!input.anesthesiaType.trim()) return "Select an anesthesia type."
  const start = timestampAtHospitalTime(input.date, input.time)
  if (Number.isNaN(start.getTime())) return "Select a valid date and time."
  if (start.getTime() <= Date.now()) return "Surgery start time must be in the future (hospital time: Asia/Karachi)."
  if (input.priority !== "EMERGENCY") {
    const startMinutes = Number(input.time.slice(0, 2)) * 60 + Number(input.time.slice(3, 5))
    if (startMinutes < 8 * 60 || startMinutes + input.duration > 20 * 60) {
      return "Only Emergency surgeries may be scheduled outside 08:00-20:00 Pakistan time."
    }
  }
  return ""
}

function isSurgicalSpecialty(specialty: string) {
  return /(surg|orthop|urolog|gyne|obstetric|ophthalm|otorhinolaryng|^ent$|neurosurg|cardiothoracic|plastic surg)/i.test(specialty)
}

export function ScheduleSurgeryModal({ open, onClose, onScheduled, initialMrNumber = "" }: { open: boolean; onClose: () => void; onScheduled: (date: string) => void; initialMrNumber?: string }) {
  const { patients, doctors, surgeries, currentUser, dispatch } = useDashboard()
  const { toast } = useToast()
  const [section, setSection] = React.useState(SECTIONS[0])
  const [mrNumber, setMrNumber] = React.useState("")
  const [procedureName, setProcedureName] = React.useState("")
  const [surgeonId, setSurgeonId] = React.useState(doctors[0]?.id ?? "")
  const [assistantSurgeonId, setAssistantSurgeonId] = React.useState("")
  const [priority, setPriority] = React.useState<"ELECTIVE" | "URGENT" | "EMERGENCY">("ELECTIVE")
  const [anesthesiaType, setAnesthesiaType] = React.useState("")
  const [consentSigned, setConsentSigned] = React.useState(false)
  const [npoConfirmed, setNpoConfirmed] = React.useState(false)
  const [labsDone, setLabsDone] = React.useState(false)
  const [bloodArranged, setBloodArranged] = React.useState(false)
  const [otRoom, setOtRoom] = React.useState(OT_ROOMS[0])
  const [date, setDate] = React.useState(() => nextDefaultSlot().date)
  const [time, setTime] = React.useState(() => nextDefaultSlot().time)
  const [duration, setDuration] = React.useState("60")
  const [notes, setNotes] = React.useState("")
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [availability, setAvailability] = React.useState<{ available: boolean; message?: string; surgeryType?: string; scheduledStart?: string } | null>(null)
  const [checkingAvailability, setCheckingAvailability] = React.useState(false)
  const [hasInteracted, setHasInteracted] = React.useState(false)
  const [scheduleError, setScheduleError] = React.useState("")
  const [now, setNow] = React.useState(() => new Date())
  const [rooms, setRooms] = React.useState<{ id: string; name: string }[]>([])

  React.useEffect(() => {
    if (open) {
      const defaultSlot = nextDefaultSlot()
      setSection(SECTIONS[0]); setMrNumber(initialMrNumber); setProcedureName(""); setOtRoom(OT_ROOMS[0])
      setSurgeonId(currentUser?.role === "doctor" ? doctors.find((doctor) => doctor.userId === currentUser.id)?.id ?? "" : doctors[0]?.id ?? "")
      setAssistantSurgeonId(""); setPriority("ELECTIVE"); setAnesthesiaType("")
      setConsentSigned(false); setNpoConfirmed(false); setLabsDone(false); setBloodArranged(false)
      setDate(defaultSlot.date); setTime(defaultSlot.time); setDuration("60"); setNotes(""); setConfirmOpen(false); setScheduleError(""); setHasInteracted(false)
    }
  }, [open, initialMrNumber])

  React.useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [open])

  React.useEffect(() => {
    if (!open || currentUser?.role !== "doctor") return
    const ownDoctor = doctors.find((doctor) => doctor.userId === currentUser.id)
    if (ownDoctor) setSurgeonId(ownDoctor.id)
  }, [open, currentUser?.id, currentUser?.role, doctors])

  React.useEffect(() => {
    if (!open) return
    api.listOTRooms().then((availableRooms) => {
      setRooms(availableRooms)
      setOtRoom((current) => availableRooms.some((room) => room.name === current) ? current : availableRooms[0]?.name ?? "")
    }).catch((cause) => toast({ title: "Unable to load operating rooms", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }))
  }, [open, toast])

  const patient = patients.find((p) => p.mrNumber === mrNumber)
  const ownSurgeon = doctors.find((candidate) => candidate.userId === currentUser?.id)
  const selectedSurgeonId = currentUser?.role === "doctor" ? ownSurgeon?.id ?? "" : (surgeonId || doctors[0]?.id || "")
  const surgeon = doctors.find((d) => d.id === selectedSurgeonId)
  const surgeonSpecialty = surgeon?.designation || surgeon?.department || "Unknown specialty"
  const surgeonSpecialtyWarning = surgeon && !isSurgicalSpecialty(`${surgeon.designation} ${surgeon.department}`)
    ? `${surgeonSpecialty} is not typically a surgical specialty for ${procedureName || "this procedure"}. You may continue if appropriate.`
    : ""

  const roomId = rooms.find((room) => room.name === otRoom)?.id
  const firstSectionError = !patient?.id
    ? "Select a valid patient."
    : !procedureName.trim()
      ? "Procedure name is required."
      : ""
  const timingError = timingValidationMessage({
    patientId: patient?.id,
    procedureName,
    surgeonId: selectedSurgeonId,
    roomId,
    date,
    time,
    duration: Number(duration),
    priority,
    anesthesiaType,
  })
  const availabilityError = availability?.available === false ? availability.message || "This surgery time is unavailable." : ""
  const inlineError = scheduleError || availabilityError || (hasInteracted ? (section === SECTIONS[0] ? firstSectionError : timingError) : "")
  const isAvailabilityBlocked = availability?.available === false
  const hospitalClock = getHospitalClock(now)

  React.useEffect(() => {
    if (!open || timingError || !patient?.id || !roomId || !selectedSurgeonId) {
      setAvailability(null)
      setCheckingAvailability(false)
      return
    }
    let cancelled = false
    setAvailability(null)
    setCheckingAvailability(false)
    const timer = window.setTimeout(() => {
      setCheckingAvailability(true)
      const start = timestampAtHospitalTime(date, time)
      const payload = {
        patientId: patient.id!,
        otRoomId: roomId,
        surgeonId: selectedSurgeonId,
        surgeryType: procedureName.trim() || "Procedure",
        priority,
        anesthesiaType,
        scheduledStart: formatHospitalTimestamp(start),
        scheduledEnd: formatHospitalTimestamp(new Date(start.getTime() + Number(duration) * 60_000)),
      }
      api.checkSurgeryAvailability(payload)
        .then((result) => { if (!cancelled) setAvailability(result) })
        .catch((error: Error) => {
          if (!cancelled) setAvailability({ available: false, message: error.message })
        })
        .finally(() => { if (!cancelled) setCheckingAvailability(false) })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, patient?.id, roomId, selectedSurgeonId, date, time, duration, priority, procedureName, anesthesiaType, timingError])

  function goNext() {
    setHasInteracted(true)
    if ((section === SECTIONS[0] && firstSectionError) || (section === SECTIONS[1] && (timingError || isAvailabilityBlocked))) return
    const idx = SECTIONS.indexOf(section)
    if (idx < SECTIONS.length - 1) setSection(SECTIONS[idx + 1])
  }

  async function submit() {
    if (!patient?.id || !surgeon || !roomId || submitting || timingError || checkingAvailability || isAvailabilityBlocked) {
      setHasInteracted(true)
      if (timingError) setScheduleError(timingError)
      return
    }
    setSubmitting(true)
    setScheduleError("")
    const start = timestampAtHospitalTime(date, time)
    const payload = {
      patientId: patient.id,
      otRoomId: roomId,
      surgeryType: procedureName.trim(),
      surgeonId: selectedSurgeonId,
      ...(assistantSurgeonId ? { assistantSurgeonId } : {}),
      priority,
      anesthesiaType: anesthesiaType.trim(),
      notes: notes.trim(),
      preOpChecklist: { consentSigned, npoConfirmed, labsDone, bloodArranged },
      scheduledStart: formatHospitalTimestamp(start),
      scheduledEnd: formatHospitalTimestamp(new Date(start.getTime() + Number(duration) * 60_000)),
    }
    try {
      const created = await api.scheduleSurgery(payload)
      const detail = await api.getSurgery(created.id, { suppressGlobalErrorToast: true })
      dispatch({ type: "SET_SURGERIES", surgeries: [toSurgery(detail), ...surgeries] })
      onScheduled(date)
      setConfirmOpen(false)
      onClose()
      toast({ title: "Surgery scheduled", description: `${procedureName} scheduled for ${patient.name}.`, variant: "success" })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to schedule surgery."
      setScheduleError(message)
      setAvailability({ available: false, message })
      setHasInteracted(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Schedule Surgery" description="Multi-section scheduling form." size="lg">
      <div className="flex flex-col gap-4">
        <Tabs
          tabs={SECTIONS}
          active={section}
          onChange={(nextSection) => {
            if (nextSection === SECTIONS[1] && firstSectionError) {
              setHasInteracted(true)
              return
            }
            if (nextSection === SECTIONS[2] && (firstSectionError || timingError || isAvailabilityBlocked)) {
              setHasInteracted(true)
              return
            }
            setSection(nextSection)
          }}
        />

        {inlineError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--cp-critical)]/30 bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{inlineError}{availability?.surgeryType ? ` — ${availability.surgeryType}` : ""}{availability?.scheduledStart ? ` at ${formatTime(availability.scheduledStart)}` : ""}</p>
          </div>
        )}
        {!hasInteracted && section === SECTIONS[0] && (
          <p role="status" className="text-xs text-[var(--cp-ink-soft)]">Select a patient and procedure to continue.</p>
        )}

        {section === "Patient & Procedure" && (
          <div className="flex flex-col gap-4">
            <div>
              <Label>Patient MR Number</Label>
              <Input value={mrNumber} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setMrNumber(e.target.value) }} placeholder="e.g. MR-2026-000101" list="mr-list-ot" />
              <datalist id="mr-list-ot">{patients.map((p) => <option key={p.mrNumber} value={p.mrNumber}>{p.name}</option>)}</datalist>
              {patient && <p className="mt-1.5 text-xs text-[var(--cp-success)]">✓ {patient.name} · {patient.age} yrs · {formatBloodGroup(patient.bloodGroup)}</p>}
            </div>
            <div>
              <Label>Procedure Name</Label>
              <Input value={procedureName} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setProcedureName(e.target.value) }} placeholder="Search or enter a procedure" list="procedure-catalog" />
              <datalist id="procedure-catalog">{PROCEDURE_CATALOG.map((name) => <option key={name} value={name} />)}</datalist>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onChange={(event) => { setHasInteracted(true); setScheduleError(""); setPriority(event.target.value as typeof priority) }}>
                <option value="ELECTIVE">Elective</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option>
              </Select>
            </div>
          </div>
        )}

        {section === "Doctor & Timing" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Surgeon</Label>
                <Select value={selectedSurgeonId} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setSurgeonId(e.target.value) }} disabled={currentUser?.role === "doctor"}>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.designation || d.department} ({d.department})</option>)}
                </Select>
                {surgeonSpecialtyWarning && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--cp-warning)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{surgeonSpecialtyWarning}</p>}
              </div>
              <div>
                <Label>Assistant Surgeon (optional)</Label>
                <Select value={assistantSurgeonId} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setAssistantSurgeonId(e.target.value) }}>
                  <option value="">None</option>
                  {doctors.filter((doctor) => doctor.id !== selectedSurgeonId).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} — {doctor.designation || doctor.department} ({doctor.department})</option>)}
                </Select>
              </div>
              <div>
                <Label>Anesthesia Type</Label>
                <Select value={anesthesiaType} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setAnesthesiaType(e.target.value) }} required>
                  <option value="">Select anesthesia</option><option>General</option><option>Regional</option><option>Spinal</option><option>Epidural</option><option>Local</option><option>Sedation</option>
                </Select>
              </div>
              <div>
                <Label>OT Room</Label>
                <Select value={otRoom} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setOtRoom(e.target.value) }}>
                  {OT_ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} min={hospitalClock.date} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setDate(e.target.value) }} className="cp-tabular" />
              </div>
              <div>
                <Label>Time</Label>
                <Select value={time} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setTime(e.target.value) }} className="cp-tabular">
                  {TIME_SLOTS.filter((slot) => priority === "EMERGENCY" || (slot >= "08:00" && slot < "20:00")).map((slot) => {
                    const slotMinutes = Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5))
                    const isPast = date === hospitalClock.date && slotMinutes <= hospitalClock.minutes
                    return <option key={slot} value={slot} disabled={isPast}>{formatTime(slot)}{isPast ? " — past" : ""}</option>
                  })}
                </Select>
              </div>
              <div>
                <Label>Duration (minutes)</Label>
                <Select value={duration} onChange={(e) => { setHasInteracted(true); setScheduleError(""); setDuration(e.target.value) }} className="cp-tabular">
                  {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((minutes) => <option key={minutes} value={minutes}>{minutes}</option>)}
                </Select>
              </div>
            </div>
            {checkingAvailability && <p role="status" className="text-xs text-[var(--cp-ink-soft)]">Checking operating room availability…</p>}
            {availability?.available && (
              <p role="status" className="rounded-xl border border-[var(--cp-success)]/30 bg-[var(--cp-success-light)] p-3 text-sm font-semibold text-[var(--cp-success)]">Free — this time is available.</p>
            )}
          </div>
        )}

        {section === "Notes" && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-[var(--cp-ink)]">Pre-op checklist</legend>
              {[
                ["Consent signed", consentSigned, setConsentSigned],
                ["NPO confirmed", npoConfirmed, setNpoConfirmed],
                ["Labs done", labsDone, setLabsDone],
                ["Blood arranged", bloodArranged, setBloodArranged],
              ].map(([label, checked, setChecked]) => (
                <label key={label as string} className="flex items-center gap-2 text-sm text-[var(--cp-ink)]">
                  <input type="checkbox" checked={checked as boolean} onChange={(event) => (setChecked as (value: boolean) => void)(event.target.checked)} />
                  {label as string}
                </label>
              ))}
            </fieldset>
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions, implants required…" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {section !== SECTIONS[SECTIONS.length - 1] ? (
            <Button size="sm" onClick={goNext} disabled={section === SECTIONS[0] ? Boolean(firstSectionError) : Boolean(timingError || checkingAvailability || isAvailabilityBlocked)}>Next</Button>
          ) : (
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={submitting || Boolean(timingError) || checkingAvailability || isAvailabilityBlocked}>Schedule Surgery</Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!submitting) setConfirmOpen(false) }}
        onConfirm={submit}
        title="Confirm Scheduling"
        description={`Schedule "${procedureName}" for ${patient?.name ?? "this patient"} in ${otRoom} on ${date} at ${time}?`}
        confirmLabel={submitting ? <><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Scheduling…</> : "Schedule"}
        confirmDisabled={submitting || Boolean(timingError) || checkingAvailability || isAvailabilityBlocked}
      />
    </Modal>
  )
}
