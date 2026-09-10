import * as React from "react"
import { AlertTriangle } from "lucide-react"
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
import { OT_STATUS_META } from "./otStatusMeta"

const SECTIONS = ["Patient & Procedure", "Doctor & Timing", "Notes"]

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export function ScheduleSurgeryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patients, doctors, surgeries, dispatch } = useDashboard()
  const { toast } = useToast()
  const [section, setSection] = React.useState(SECTIONS[0])
  const [mrNumber, setMrNumber] = React.useState("")
  const [procedureName, setProcedureName] = React.useState("")
  const [surgeonId, setSurgeonId] = React.useState(doctors[0]?.id ?? "")
  const [otRoom, setOtRoom] = React.useState(OT_ROOMS[0])
  const [date, setDate] = React.useState(isoDate(new Date()))
  const [time, setTime] = React.useState("10:00")
  const [duration, setDuration] = React.useState("60")
  const [notes, setNotes] = React.useState("")
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [rooms, setRooms] = React.useState<{ id: string; name: string }[]>([])

  React.useEffect(() => {
    if (open) {
      setSection(SECTIONS[0]); setMrNumber(""); setProcedureName(""); setOtRoom(OT_ROOMS[0])
      setDate(isoDate(new Date())); setTime("10:00"); setDuration("60"); setNotes(""); setConfirmOpen(false); setErrors({})
    }
  }, [open])

  React.useEffect(() => { if (open) api.listOTRooms().then(setRooms).catch(() => undefined) }, [open])

  const patient = patients.find((p) => p.mrNumber === mrNumber)
  const surgeon = doctors.find((d) => d.id === surgeonId)

  const conflict = surgeries.find(
    (s) => s.otRoom === otRoom && s.scheduledDate === date && s.scheduledTime === time && s.status !== "Cancelled" && s.status !== "Completed"
  )

  function goNext() {
    const e: Record<string, string> = {}
    if (section === "Patient & Procedure") {
      if (!patient) e.mrNumber = "Select a valid MR number."
      if (!procedureName.trim()) e.procedureName = "Procedure name is required."
    }
    setErrors(e)
    if (Object.keys(e).length) return
    const idx = SECTIONS.indexOf(section)
    if (idx < SECTIONS.length - 1) setSection(SECTIONS[idx + 1])
  }

  function submit() {
    if (!patient || !surgeon) return
    const room = rooms.find((item) => item.name === otRoom)
    if (!room || !patient.id) { toast({ title: "Unable to schedule", description: "Patient or OT room is unavailable.", variant: "error" }); return }
    const start = new Date(`${date}T${time}:00`)
    const end = new Date(start.getTime() + (Number(duration) || 60) * 60000)
    api.scheduleSurgery({ patientId: patient.id, otRoomId: room.id, surgeryType: procedureName.trim(), surgeonId: surgeon.id, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() })
      .then((created) => api.getSurgery(created.id))
      .then((created) => { dispatch({ type: "SET_SURGERIES", surgeries: [toSurgery(created), ...surgeries] }); toast({ title: "Surgery scheduled", description: `${procedureName} scheduled for ${patient.name}.`, variant: "success" }); setConfirmOpen(false); onClose() })
      .catch((error: Error) => toast({ title: "Unable to schedule", description: error.message, variant: "error" }))
  }

  return (
    <Modal open={open} onClose={onClose} title="Schedule Surgery" description="Multi-section scheduling form." size="lg">
      <div className="flex flex-col gap-4">
        <Tabs tabs={SECTIONS} active={section} onChange={setSection} />

        {section === "Patient & Procedure" && (
          <div className="flex flex-col gap-4">
            <div>
              <Label>Patient MR Number</Label>
              <Input value={mrNumber} onChange={(e) => setMrNumber(e.target.value)} placeholder="e.g. MR-2026-000101" list="mr-list-ot" />
              <datalist id="mr-list-ot">{patients.map((p) => <option key={p.mrNumber} value={p.mrNumber}>{p.name}</option>)}</datalist>
              {patient && <p className="mt-1.5 text-xs text-[var(--cp-success)]">✓ {patient.name} · {patient.age} yrs · {patient.bloodGroup}</p>}
              {errors.mrNumber && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.mrNumber}</p>}
            </div>
            <div>
              <Label>Procedure Name</Label>
              <Input value={procedureName} onChange={(e) => setProcedureName(e.target.value)} placeholder="e.g. Appendectomy" />
              {errors.procedureName && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.procedureName}</p>}
            </div>
          </div>
        )}

        {section === "Doctor & Timing" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Surgeon</Label>
                <Select value={surgeonId} onChange={(e) => setSurgeonId(e.target.value)}>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.department}</option>)}
                </Select>
              </div>
              <div>
                <Label>OT Room</Label>
                <Select value={otRoom} onChange={(e) => setOtRoom(e.target.value)}>
                  {OT_ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="cp-tabular" />
              </div>
              <div>
                <Label>Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="cp-tabular" />
              </div>
              <div>
                <Label>Duration (minutes)</Label>
                <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className="cp-tabular" />
              </div>
            </div>
            {conflict && (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--cp-warning)]/30 bg-[var(--cp-warning-light)] p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--cp-warning)]" />
                <p className="text-xs text-[var(--cp-ink)]"><span className="font-semibold">Scheduling conflict:</span> {otRoom} already has "{conflict.procedureName}" at {conflict.scheduledTime} on this date.</p>
              </div>
            )}
          </div>
        )}

        {section === "Notes" && (
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions, anesthesia type, implants required…" />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {section !== SECTIONS[SECTIONS.length - 1] ? (
            <Button size="sm" onClick={goNext}>Next</Button>
          ) : (
            <Button size="sm" onClick={() => setConfirmOpen(true)}>Schedule Surgery</Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        title="Confirm Scheduling"
        description={`Schedule "${procedureName}" for ${patient?.name ?? "this patient"} in ${otRoom} on ${date} at ${time}?`}
        confirmLabel="Schedule"
      />
    </Modal>
  )
}
